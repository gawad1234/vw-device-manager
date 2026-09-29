<#
.SYNOPSIS
    Creates a Hyper-V external virtual switch and a set of host (management OS)
    virtual network adapters: one untagged (native VLAN) adapter plus one adapter
    per tagged VLAN, each with its own IP configuration.

.DESCRIPTION
    - Verifies admin rights and that the Hyper-V PowerShell module is available.
    - Creates an External vSwitch bound to a physical NIC (or reuses an existing one).
    - Creates the untagged adapter from the network marked Tagged = $false, and
      removes the switch's default "vEthernet (<SwitchName>)" adapter.
    - For each tagged VLAN, creates a host vNIC named "vEthernet (<Name>)",
      sets an Access VLAN ID on it, and applies static IP / DHCP settings.
    - Idempotent: existing switch/adapters are reused and reconfigured, not duplicated.
    - Supports -WhatIf and -Teardown.

    The network list is baked into $DefaultVlans below. -ConfigPath can still
    override it with a JSON file (see the example at the bottom of this file).

.PARAMETER SwitchName
    Name of the Hyper-V virtual switch to create or reuse.

.PARAMETER PhysicalAdapterName
    Name of the physical NIC to bind the switch to (see Get-NetAdapter -Physical).
    If omitted, you'll be prompted to choose from the connected physical adapters.

.PARAMETER ConfigPath
    Optional path to a JSON file that replaces the built-in network list.

.PARAMETER Teardown
    Removes the host adapters defined in the list, then the switch.

.EXAMPLE
    .\HTAB_MGR61-NetConfig.ps1 -PhysicalAdapterName "Ethernet" -WhatIf

.EXAMPLE
    .\HTAB_MGR61-NetConfig.ps1 -PhysicalAdapterName "Ethernet"

.EXAMPLE
    .\HTAB_MGR61-NetConfig.ps1 -Teardown
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$SwitchName = "__SWITCH_NAME__",
    [string]$PhysicalAdapterName,
    [string]$ConfigPath,
    [switch]$Teardown
)

#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Network list
#   Name          : adapter name (appears as "vEthernet (<Name>)")
#   VlanId        : 1-4094 (for the untagged network this is informational only)
#   Tagged        : $false for the ONE untagged/native network, $true for tagged VLANs
#   Dhcp          : $true to use DHCP (IP settings are ignored)
#   IPAddress     : static IPv4 address
#   PrefixLength  : subnet prefix (24 = 255.255.255.0)
#   Gateway       : optional - set on at most ONE adapter
#   DnsServers    : optional array of DNS servers
# ---------------------------------------------------------------------------
$DefaultVlans = @(
__VLANS_BLOCK__
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Note($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

# Hyper-V's management service can lag behind right after a switch or vNIC change,
# producing "object was not found on computer '<name>'" errors. Retry a few times.
function Invoke-HyperV([scriptblock]$Action, [string]$What, [int]$Tries = 5) {
    for ($i = 1; $i -le $Tries; $i++) {
        try { return & $Action }
        catch {
            if ($i -eq $Tries) { throw "$What failed: $($_.Exception.Message)" }
            Start-Sleep -Seconds 2
        }
    }
}

function Wait-HostVNic($name, [int]$timeoutSec = 30) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $timeoutSec) {
        if (Get-VMNetworkAdapter -ManagementOS -Name $name -ErrorAction SilentlyContinue) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "Hyper-V never registered host vNIC '$name'."
}

function Get-VlanConfig {
    if ($ConfigPath) {
        if (-not (Test-Path $ConfigPath)) { throw "Config file not found: $ConfigPath" }
        $json = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        return $json | ForEach-Object {
            $h = @{}
            $_.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value }
            if ($null -eq $h.Tagged) { $h.Tagged = $true }
            $h
        }
    }
    return $DefaultVlans
}

function Test-VlanConfig($vlans) {
    $names = @{}; $ids = @{}
    foreach ($v in $vlans) {
        if (-not $v.Name) { throw "A network entry is missing 'Name'." }
        if ($names[$v.Name]) { throw "Duplicate adapter name: $($v.Name)" }
        if ($v.Name -eq $SwitchName) { throw "Adapter name '$($v.Name)' can't match the switch name." }
        if ($v.Tagged) {
            if ($v.VlanId -lt 1 -or $v.VlanId -gt 4094) { throw "$($v.Name): VlanId must be 1-4094." }
            if ($ids[[int]$v.VlanId]) { Write-Note "VLAN $($v.VlanId) is tagged on more than one adapter." }
            $ids[[int]$v.VlanId] = $true
        }
        if (-not $v.Dhcp -and (-not $v.IPAddress -or -not $v.PrefixLength)) {
            throw "$($v.Name): static config needs IPAddress and PrefixLength (or set Dhcp = true)."
        }
        $names[$v.Name] = $true
    }
    if (@($vlans | Where-Object { -not $_.Tagged }).Count -gt 1) {
        throw "Only one network can be untagged."
    }
    if (@($vlans | Where-Object { -not $_.Dhcp -and $_.Gateway }).Count -gt 1) {
        Write-Note "More than one adapter has a default gateway. This usually causes routing problems."
    }
}

function Wait-HostAdapter($name, [int]$timeoutSec = 30) {
    $ifName = "vEthernet ($name)"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $timeoutSec) {
        $a = Get-NetAdapter -Name $ifName -ErrorAction SilentlyContinue
        if ($a) { return $a }
        Start-Sleep -Milliseconds 500
    }
    throw "Timed out waiting for adapter '$ifName' to appear."
}

# Returns $true for Wi-Fi, WWAN/cellular, and Bluetooth adapters.
# Checks the NDIS physical medium first (most reliable), then media type and description.
function Test-WirelessAdapter($nic) {
    # NdisPhysicalMedium: 1 = WirelessLan, 8 = WirelessWan, 9 = Native 802.11, 10 = Bluetooth
    if ($nic.NdisPhysicalMedium -in 1, 8, 9, 10) { return $true }
    if ($nic.MediaType -match '802\.11|Wireless') { return $true }
    if ($nic.PhysicalMediaType -match '802\.11|Wireless|BlueTooth|WWAN') { return $true }
    if ($nic.InterfaceDescription -match 'Wi-?Fi|Wireless|WLAN|802\.11|Bluetooth|WWAN|Mobile Broadband|Cellular') { return $true }
    if ($nic.Name -match 'Wi-?Fi|Wireless|WLAN|Bluetooth|Cellular') { return $true }
    return $false
}

function Assert-WiredAdapter($nic) {
    if (Test-WirelessAdapter $nic) {
        throw "'$($nic.Name)' [$($nic.InterfaceDescription)] is a wireless adapter. This script only binds the switch to a wired Ethernet adapter."
    }
}

function Select-PhysicalAdapter {
    $all = @(Get-NetAdapter -Physical | Where-Object Status -eq 'Up')
    $skipped = @($all | Where-Object { Test-WirelessAdapter $_ })
    foreach ($w in $skipped) { Write-Note "Ignoring wireless adapter '$($w.Name)' [$($w.InterfaceDescription)]" }

    $candidates = @($all | Where-Object { -not (Test-WirelessAdapter $_) })
    if ($candidates.Count -eq 0) { throw "No connected wired Ethernet adapters found. Plug in a cable and try again." }
    if ($candidates.Count -eq 1) {
        Write-Ok "Using '$($candidates[0].Name)' [$($candidates[0].InterfaceDescription)]"
        return $candidates[0].Name
    }

    Write-Host "`nConnected wired adapters:"
    for ($i = 0; $i -lt $candidates.Count; $i++) {
        "{0}) {1}  [{2}]  {3}" -f ($i + 1), $candidates[$i].Name, $candidates[$i].InterfaceDescription, $candidates[$i].LinkSpeed | Write-Host
    }
    $idx = [int](Read-Host "Select adapter number") - 1
    if ($idx -lt 0 -or $idx -ge $candidates.Count) { throw "Invalid selection." }
    return $candidates[$idx].Name
}

function Set-HostAdapterIp($vlan) {
    $adapter = Wait-HostAdapter $vlan.Name
    $idx = $adapter.ifIndex

    if ($vlan.Dhcp) {
        if ($PSCmdlet.ShouldProcess($adapter.Name, "Enable DHCP")) {
            Get-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                Where-Object PrefixOrigin -ne 'Dhcp' | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue
            Get-NetRoute -InterfaceIndex $idx -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
                Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
            Set-NetIPInterface -InterfaceIndex $idx -AddressFamily IPv4 -Dhcp Enabled
            Set-DnsClientServerAddress -InterfaceIndex $idx -ResetServerAddresses
            Write-Ok "DHCP enabled"
        }
        return
    }

    $current = @(Get-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue)
    $currentGw = (Get-NetRoute -InterfaceIndex $idx -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue).NextHop
    $ipMatches = $current.Count -eq 1 -and $current[0].IPAddress -eq $vlan.IPAddress -and
                 $current[0].PrefixLength -eq $vlan.PrefixLength
    $gwMatches = ("$currentGw" -eq "$($vlan.Gateway)")

    if ($ipMatches -and $gwMatches) {
        Write-Ok "IP $($vlan.IPAddress)/$($vlan.PrefixLength) already set"
    }
    elseif ($PSCmdlet.ShouldProcess($adapter.Name, "Set static IP $($vlan.IPAddress)/$($vlan.PrefixLength)")) {

        # Wait until the IPv4 stack is bound to the new adapter
        $sw = [Diagnostics.Stopwatch]::StartNew()
        while (-not (Get-NetIPInterface -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue)) {
            if ($sw.Elapsed.TotalSeconds -gt 20) { throw "IPv4 never became available on '$($adapter.Name)'." }
            Start-Sleep -Milliseconds 500
        }

        # If this IP lives on another interface, move it (stale vEthernet or the bound physical NIC),
        # otherwise report the conflict and skip this adapter.
        $elsewhere = @(foreach ($store in 'ActiveStore', 'PersistentStore') {
            Get-NetIPAddress -IPAddress $vlan.IPAddress -PolicyStore $store -ErrorAction SilentlyContinue |
                Where-Object InterfaceIndex -ne $idx
        })
        foreach ($e in $elsewhere) {
            if ($e.InterfaceAlias -like 'vEthernet*' -or $e.InterfaceAlias -eq $PhysicalAdapterName) {
                Write-Note "Removing $($vlan.IPAddress) from '$($e.InterfaceAlias)' ($($e.Store))"
                $e | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue
            } else {
                Write-Warning "$($vlan.IPAddress) is already assigned to '$($e.InterfaceAlias)'. Remove it there, then re-run. Skipping '$($adapter.Name)'."
                return
            }
        }

        # Clear this adapter's IPv4 addresses and default routes from BOTH stores
        Set-NetIPInterface -InterfaceIndex $idx -AddressFamily IPv4 -Dhcp Disabled
        foreach ($store in 'ActiveStore', 'PersistentStore') {
            Get-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -PolicyStore $store -ErrorAction SilentlyContinue |
                Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue
            Get-NetRoute -InterfaceIndex $idx -DestinationPrefix '0.0.0.0/0' -PolicyStore $store -ErrorAction SilentlyContinue |
                Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds 500

        $ipArgs = @{
            InterfaceIndex = $idx
            AddressFamily  = 'IPv4'
            IPAddress      = $vlan.IPAddress
            PrefixLength   = [byte]$vlan.PrefixLength
        }
        if ($vlan.Gateway) { $ipArgs.DefaultGateway = $vlan.Gateway }

        # Retry - freshly created vNICs sometimes reject the first attempt
        $ok = $false
        for ($try = 1; $try -le 3 -and -not $ok; $try++) {
            try {
                New-NetIPAddress @ipArgs -ErrorAction Stop | Out-Null
                $ok = $true
            } catch {
                # An earlier attempt may have created the address even though it reported an error
                $landed = Get-NetIPAddress -InterfaceIndex $idx -IPAddress $vlan.IPAddress -ErrorAction SilentlyContinue
                if ($landed) {
                    if ($landed.PrefixLength -ne $vlan.PrefixLength) {
                        Set-NetIPAddress -InterfaceIndex $idx -IPAddress $vlan.IPAddress -PrefixLength $vlan.PrefixLength
                    }
                    if ($vlan.Gateway -and -not (Get-NetRoute -InterfaceIndex $idx -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue)) {
                        New-NetRoute -InterfaceIndex $idx -DestinationPrefix '0.0.0.0/0' -NextHop $vlan.Gateway | Out-Null
                    }
                    $ok = $true
                    break
                }
                $owner = Get-NetIPAddress -IPAddress $vlan.IPAddress -ErrorAction SilentlyContinue
                if ($owner) {
                    Write-Warning "$($vlan.IPAddress) is held by '$($owner.InterfaceAlias -join "', '")'. Skipping '$($adapter.Name)'."
                    return
                }
                if ($try -eq 3) {
                    Write-Warning "Could not set $($vlan.IPAddress)/$($vlan.PrefixLength) on '$($adapter.Name)': $($_.Exception.Message)"
                    return
                }
                Start-Sleep -Seconds 2
            }
        }
        Write-Ok "IP $($vlan.IPAddress)/$($vlan.PrefixLength)$(if ($vlan.Gateway) { " gw $($vlan.Gateway)" })"
    }

    if ($PSCmdlet.ShouldProcess($adapter.Name, "Set DNS")) {
        if ($vlan.DnsServers -and @($vlan.DnsServers).Count -gt 0) {
            Set-DnsClientServerAddress -InterfaceIndex $idx -ServerAddresses $vlan.DnsServers
            Write-Ok "DNS $(@($vlan.DnsServers) -join ', ')"
        } else {
            Set-DnsClientServerAddress -InterfaceIndex $idx -ResetServerAddresses
        }
    }
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
if (-not (Get-Module -ListAvailable -Name Hyper-V)) {
    throw @"
The Hyper-V PowerShell module isn't installed. Hyper-V requires Windows 11 Pro,
Enterprise, or Education. Enable it with (then reboot):
  Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All
"@
}
Import-Module Hyper-V

$vlans = @(Get-VlanConfig)
Test-VlanConfig $vlans
$untagged = $vlans | Where-Object { -not $_.Tagged } | Select-Object -First 1
$tagged   = @($vlans | Where-Object { $_.Tagged })

# ---------------------------------------------------------------------------
# Teardown mode
# ---------------------------------------------------------------------------
if ($Teardown) {
    Write-Step "Removing host adapters"
    foreach ($name in @($vlans.Name) + $SwitchName) {
        $vnic = Get-VMNetworkAdapter -ManagementOS -Name $name -ErrorAction SilentlyContinue
        if ($vnic -and $PSCmdlet.ShouldProcess($name, "Remove host vNIC")) {
            Remove-VMNetworkAdapter -ManagementOS -Name $name
            Write-Ok "Removed $name"
        }
    }
    $sw = Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue
    if ($sw -and $PSCmdlet.ShouldProcess($SwitchName, "Remove virtual switch")) {
        Remove-VMSwitch -Name $SwitchName -Force
        Write-Ok "Removed switch $SwitchName"
    }
    return
}

# ---------------------------------------------------------------------------
# 1. Virtual switch
# ---------------------------------------------------------------------------
Write-Step "Virtual switch '$SwitchName'"
$switch = Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue

if ($switch) {
    if ($switch.SwitchType -ne 'External') {
        Write-Note "Switch is not External - VLAN traffic won't reach the physical network."
    } else {
        # Make sure an existing switch isn't bound to a wireless adapter
        $bound = Get-NetAdapter -Physical | Where-Object InterfaceDescription -eq $switch.NetAdapterInterfaceDescription
        if ($bound -and (Test-WirelessAdapter $bound)) {
            throw "Existing switch '$SwitchName' is bound to wireless adapter '$($bound.Name)'. Run with -Teardown, then re-run with a wired adapter."
        }
        if ($bound) { $PhysicalAdapterName = $bound.Name }
    }
    Write-Ok "Already exists ($($switch.SwitchType)); reusing"
} else {
    if (-not $PhysicalAdapterName) { $PhysicalAdapterName = Select-PhysicalAdapter }
    $nic = Get-NetAdapter -Name $PhysicalAdapterName -Physical -ErrorAction SilentlyContinue
    if (-not $nic) { throw "Physical adapter '$PhysicalAdapterName' not found." }
    Assert-WiredAdapter $nic

    if ($PSCmdlet.ShouldProcess($PhysicalAdapterName, "Create External switch '$SwitchName'")) {
        Write-Note "Network on '$PhysicalAdapterName' will drop for a few seconds."
        New-VMSwitch -Name $SwitchName -NetAdapterName $PhysicalAdapterName -AllowManagementOS $true | Out-Null
        Write-Ok "Created, bound to '$PhysicalAdapterName'"
    }
}

# ---------------------------------------------------------------------------
# 2. Host adapters (untagged first, then tagged VLANs)
# ---------------------------------------------------------------------------
$ordered = @()
if ($untagged) { $ordered += $untagged }
$ordered += $tagged

foreach ($v in $ordered) {
    $label = if ($v.Tagged) { "VLAN $($v.VlanId), tagged" } else { "untagged / native" }
    Write-Step "Adapter '$($v.Name)' ($label)"

    $vnic = Get-VMNetworkAdapter -ManagementOS -Name $v.Name -ErrorAction SilentlyContinue
    if (-not $vnic) {
        if ($PSCmdlet.ShouldProcess($v.Name, "Add host vNIC on '$SwitchName'")) {
            Invoke-HyperV { Add-VMNetworkAdapter -ManagementOS -Name $v.Name -SwitchName $SwitchName -ErrorAction Stop } "Creating '$($v.Name)'"
            Wait-HostVNic $v.Name
            Write-Ok "Created"
        } else { continue }
    } elseif ($vnic.SwitchName -ne $SwitchName) {
        if ($PSCmdlet.ShouldProcess($v.Name, "Reconnect to '$SwitchName'")) {
            Invoke-HyperV { Connect-VMNetworkAdapter -ManagementOS -Name $v.Name -SwitchName $SwitchName -ErrorAction Stop } "Reconnecting '$($v.Name)'"
            Write-Ok "Reconnected to '$SwitchName'"
        }
    } else {
        Write-Ok "Already exists"
    }

    $vlanSetting = Get-VMNetworkAdapterVlan -ManagementOS -VMNetworkAdapterName $v.Name -ErrorAction SilentlyContinue
    if ($v.Tagged) {
        if ($vlanSetting.OperationMode -eq 'Access' -and $vlanSetting.AccessVlanId -eq $v.VlanId) {
            Write-Ok "VLAN $($v.VlanId) already set"
        } elseif ($PSCmdlet.ShouldProcess($v.Name, "Set Access VLAN $($v.VlanId)")) {
            Invoke-HyperV { Set-VMNetworkAdapterVlan -ManagementOS -VMNetworkAdapterName $v.Name -Access -VlanId $v.VlanId -ErrorAction Stop } "Tagging '$($v.Name)'"
            Write-Ok "Tagged VLAN $($v.VlanId)"
        }
    } else {
        if ($vlanSetting.OperationMode -eq 'Untagged') {
            Write-Ok "Already untagged"
        } elseif ($PSCmdlet.ShouldProcess($v.Name, "Set untagged")) {
            Invoke-HyperV { Set-VMNetworkAdapterVlan -ManagementOS -VMNetworkAdapterName $v.Name -Untagged -ErrorAction Stop } "Untagging '$($v.Name)'"
            Write-Ok "Set untagged"
        }
    }

    if (-not $WhatIfPreference) { Set-HostAdapterIp $v }
}

# Remove the switch's auto-created default adapter; the untagged network above replaces it
$default = Get-VMNetworkAdapter -ManagementOS -Name $SwitchName -ErrorAction SilentlyContinue
if ($default) {
    Write-Step "Default adapter 'vEthernet ($SwitchName)'"
    if ($PSCmdlet.ShouldProcess($SwitchName, "Remove default host adapter")) {
        Remove-VMNetworkAdapter -ManagementOS -Name $SwitchName
        Write-Ok "Removed (replaced by '$(if ($untagged) { $untagged.Name } else { 'nothing - no untagged network defined' })')"
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
if (-not $WhatIfPreference) {
    Write-Step "Summary"
    Get-VMNetworkAdapterVlan -ManagementOS |
        Where-Object { $_.ParentAdapter.SwitchName -eq $SwitchName } |
        ForEach-Object {
            $name  = $_.ParentAdapter.Name
            $alias = "vEthernet ($name)"
            [pscustomobject]@{
                Adapter = $alias
                VLAN    = if ($_.OperationMode -eq 'Access') { $_.AccessVlanId } else { 'untagged' }
                IPv4    = ((Get-NetIPAddress -InterfaceAlias $alias -AddressFamily IPv4 -ErrorAction SilentlyContinue) |
                            ForEach-Object { "$($_.IPAddress)/$($_.PrefixLength)" }) -join ', '
                Gateway = (Get-NetRoute -InterfaceAlias $alias -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue).NextHop
            }
        } | Sort-Object { if ($_.VLAN -eq 'untagged') { -1 } else { [int]$_.VLAN } } | Format-Table -AutoSize
}

<#
Optional vlans.json for -ConfigPath (replaces the built-in list):

[
  { "Name": "VLAN 1 - Management", "VlanId": 1, "Tagged": false, "Dhcp": false,
    "IPAddress": "10.134.1.61", "PrefixLength": 24, "Gateway": "10.134.1.250" },
  { "Name": "VLAN 10 - Device Net", "VlanId": 10, "Tagged": true, "Dhcp": false,
    "IPAddress": "10.134.10.61", "PrefixLength": 24 }
]
#>
