<#
.SYNOPSIS
    A small GUI for managing a Hyper-V host's VLAN adapters — lists the VLANs
    that are there right now, lets you add / edit / remove them, and applies the
    changes live (with a preview first). A friendly front-end to the proven
    Apply-VlanConfig.ps1 engine that sits next to this file.

.DESCRIPTION
    - Reads the live host networking (external vSwitch + management-OS vNICs and
      their VLAN tags / IPs) into an editable list.
    - Load / Save the same JSON that Device Manager's Configs tab exports, so the
      app and this tool stay in sync.
    - Preview shows exactly what will change (dry run) before anything happens.
    - Apply calls Apply-VlanConfig.ps1 to make the changes (idempotent + retried).
    - Needs Windows 10/11 Pro+ with Hyper-V, and administrator rights (it will
      relaunch elevated automatically).

    Run it by right-clicking → "Run with PowerShell", or:
        powershell -ExecutionPolicy Bypass -File .\VlanManager.ps1
#>

# --- Relaunch elevated if we're not admin -----------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList (
        '-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', "`"$PSCommandPath`"")
    return
}

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$EngineScript = Join-Path $PSScriptRoot 'Apply-VlanConfig.ps1'
if (-not (Test-Path $EngineScript)) {
    [System.Windows.Forms.MessageBox]::Show(
        "Apply-VlanConfig.ps1 wasn't found next to this tool. Keep both files in the same folder.",
        'Device Manager — VLAN Manager', 'OK', 'Error') | Out-Null
    return
}

# Authoritative row list: array of hashtables matching the engine's JSON schema
# (Name, VlanId, Tagged, Dhcp, IPAddress, PrefixLength, Gateway, DnsServers).
$script:Vlans = @()

# ---------------------------------------------------------------------------
# Live host state
# ---------------------------------------------------------------------------
function Get-ExternalSwitchNames {
    try {
        Import-Module Hyper-V -ErrorAction Stop
        return @(Get-VMSwitch -ErrorAction SilentlyContinue |
            Where-Object SwitchType -eq 'External' | Select-Object -ExpandProperty Name)
    } catch { return @() }
}

function Read-LiveVlans {
    Import-Module Hyper-V -ErrorAction Stop
    $rows = @()
    foreach ($vlan in (Get-VMNetworkAdapterVlan -ManagementOS -ErrorAction SilentlyContinue)) {
        $name = $vlan.ParentAdapter.Name
        if (-not $name) { continue }
        $alias = "vEthernet ($name)"
        $tagged = $vlan.OperationMode -eq 'Access'
        $ipi = Get-NetIPInterface -InterfaceAlias $alias -AddressFamily IPv4 -ErrorAction SilentlyContinue
        $dhcp = $ipi -and $ipi.Dhcp -eq 'Enabled'
        $ip = Get-NetIPAddress -InterfaceAlias $alias -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object PrefixOrigin -ne 'WellKnown' | Select-Object -First 1
        $gw = (Get-NetRoute -InterfaceAlias $alias -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
            Select-Object -First 1).NextHop
        $dns = @((Get-DnsClientServerAddress -InterfaceAlias $alias -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses)
        $rows += @{
            Name         = [string]$name
            VlanId       = if ($tagged) { [int]$vlan.AccessVlanId } else { 0 }
            Tagged       = [bool]$tagged
            Dhcp         = [bool]$dhcp
            IPAddress    = if ($ip) { [string]$ip.IPAddress } else { $null }
            PrefixLength = if ($ip) { [int]$ip.PrefixLength } else { 24 }
            Gateway      = if ($gw) { [string]$gw } else { $null }
            DnsServers   = @($dns | Where-Object { $_ })
        }
    }
    return , @($rows)
}

# ---------------------------------------------------------------------------
# JSON load / save (Device Manager schema)
# ---------------------------------------------------------------------------
function ConvertFrom-ConfigJson($path) {
    $json = Get-Content $path -Raw | ConvertFrom-Json
    $rows = @()
    foreach ($o in @($json)) {
        $rows += @{
            Name         = [string]$o.Name
            VlanId       = if ($null -ne $o.VlanId) { [int]$o.VlanId } else { 0 }
            Tagged       = if ($null -ne $o.Tagged) { [bool]$o.Tagged } else { $true }
            Dhcp         = [bool]$o.Dhcp
            IPAddress    = if ($o.IPAddress) { [string]$o.IPAddress } else { $null }
            PrefixLength = if ($o.PrefixLength) { [int]$o.PrefixLength } else { 24 }
            Gateway      = if ($o.Gateway) { [string]$o.Gateway } else { $null }
            DnsServers   = @($o.DnsServers | Where-Object { $_ })
        }
    }
    return , @($rows)
}

function ConvertTo-ConfigJson($rows) {
    $out = foreach ($v in $rows) {
        [ordered]@{
            Name         = $v.Name
            VlanId       = [int]$v.VlanId
            Tagged       = [bool]$v.Tagged
            Dhcp         = [bool]$v.Dhcp
            IPAddress    = $v.IPAddress
            PrefixLength = [int]$v.PrefixLength
            Gateway      = $v.Gateway
            DnsServers   = @($v.DnsServers)
        }
    }
    # Wrap single entries in an array so the JSON is always a list.
    return ConvertTo-Json @($out) -Depth 5
}

# ---------------------------------------------------------------------------
# Add / Edit dialog
# ---------------------------------------------------------------------------
function Show-VlanDialog($existing) {
    $dlg = New-Object System.Windows.Forms.Form
    $dlg.Text = if ($existing) { 'Edit VLAN' } else { 'Add VLAN' }
    $dlg.Size = New-Object System.Drawing.Size(380, 360)
    $dlg.StartPosition = 'CenterParent'
    $dlg.FormBorderStyle = 'FixedDialog'
    $dlg.MaximizeBox = $false; $dlg.MinimizeBox = $false

    $y = 16
    function Add-Label($text) {
        $l = New-Object System.Windows.Forms.Label
        $l.Text = $text; $l.Location = New-Object System.Drawing.Point(16, $y)
        $l.Size = New-Object System.Drawing.Size(120, 22)
        $dlg.Controls.Add($l)
    }
    function New-Box($val) {
        $t = New-Object System.Windows.Forms.TextBox
        $t.Location = New-Object System.Drawing.Point(140, $y)
        $t.Size = New-Object System.Drawing.Size(210, 22)
        $t.Text = [string]$val
        $dlg.Controls.Add($t); return $t
    }

    Add-Label 'Adapter name';  $tName = New-Box ($existing.Name);                 $y += 32
    Add-Label 'VLAN ID (1-4094)'; $tVlan = New-Box ($(if ($existing) { $existing.VlanId })); $y += 32

    Add-Label 'Tagged VLAN'
    $cbTagged = New-Object System.Windows.Forms.CheckBox
    $cbTagged.Location = New-Object System.Drawing.Point(140, $y)
    $cbTagged.Size = New-Object System.Drawing.Size(210, 22)
    $cbTagged.Text = 'Tagged (uncheck for the native/untagged network)'
    $cbTagged.Checked = if ($existing) { [bool]$existing.Tagged } else { $true }
    $dlg.Controls.Add($cbTagged); $y += 32

    Add-Label 'Use DHCP'
    $cbDhcp = New-Object System.Windows.Forms.CheckBox
    $cbDhcp.Location = New-Object System.Drawing.Point(140, $y)
    $cbDhcp.Size = New-Object System.Drawing.Size(210, 22)
    $cbDhcp.Checked = if ($existing) { [bool]$existing.Dhcp } else { $false }
    $dlg.Controls.Add($cbDhcp); $y += 32

    Add-Label 'IP address';    $tIp = New-Box ($existing.IPAddress);     $y += 32
    Add-Label 'Prefix length'; $tPrefix = New-Box ($(if ($existing) { $existing.PrefixLength } else { 24 })); $y += 32
    Add-Label 'Gateway (opt)'; $tGw = New-Box ($existing.Gateway);       $y += 32
    Add-Label 'DNS (comma sep)'; $tDns = New-Box (@($existing.DnsServers) -join ', '); $y += 40

    # Static fields grey out under DHCP
    $applyDhcp = {
        $on = -not $cbDhcp.Checked
        $tIp.Enabled = $on; $tPrefix.Enabled = $on; $tGw.Enabled = $on; $tDns.Enabled = $on
    }
    $cbDhcp.Add_CheckedChanged($applyDhcp); & $applyDhcp
    $tVlan.Enabled = $cbTagged.Checked
    $cbTagged.Add_CheckedChanged({ $tVlan.Enabled = $cbTagged.Checked })

    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = 'OK'; $ok.Location = New-Object System.Drawing.Point(180, $y)
    $ok.Size = New-Object System.Drawing.Size(80, 26); $ok.DialogResult = 'OK'
    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = 'Cancel'; $cancel.Location = New-Object System.Drawing.Point(270, $y)
    $cancel.Size = New-Object System.Drawing.Size(80, 26); $cancel.DialogResult = 'Cancel'
    $dlg.Controls.AddRange(@($ok, $cancel))
    $dlg.AcceptButton = $ok; $dlg.CancelButton = $cancel

    if ($dlg.ShowDialog() -ne 'OK') { return $null }

    $name = $tName.Text.Trim()
    if (-not $name) {
        [System.Windows.Forms.MessageBox]::Show('Adapter name is required.', 'VLAN Manager', 'OK', 'Warning') | Out-Null
        return (Show-VlanDialog $existing)
    }
    $tagged = $cbTagged.Checked
    $vlanId = 0
    if ($tagged) {
        if (-not [int]::TryParse($tVlan.Text.Trim(), [ref]$vlanId) -or $vlanId -lt 1 -or $vlanId -gt 4094) {
            [System.Windows.Forms.MessageBox]::Show('Tagged VLANs need a VLAN ID between 1 and 4094.', 'VLAN Manager', 'OK', 'Warning') | Out-Null
            return (Show-VlanDialog $existing)
        }
    }
    $prefix = 24; [int]::TryParse($tPrefix.Text.Trim(), [ref]$prefix) | Out-Null
    return @{
        Name         = $name
        VlanId       = $vlanId
        Tagged       = $tagged
        Dhcp         = $cbDhcp.Checked
        IPAddress    = if ($cbDhcp.Checked) { $null } else { $tIp.Text.Trim() }
        PrefixLength = $prefix
        Gateway      = if ($cbDhcp.Checked -or -not $tGw.Text.Trim()) { $null } else { $tGw.Text.Trim() }
        DnsServers   = @($tDns.Text -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }
}

# ---------------------------------------------------------------------------
# Main window
# ---------------------------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Device Manager — Hyper-V VLAN Manager'
$form.Size = New-Object System.Drawing.Size(780, 640)
$form.StartPosition = 'CenterScreen'
$form.MinimumSize = New-Object System.Drawing.Size(680, 560)

# Top row: switch name + physical adapter + refresh
$lblSwitch = New-Object System.Windows.Forms.Label
$lblSwitch.Text = 'Virtual switch'; $lblSwitch.Location = '16,18'; $lblSwitch.AutoSize = $true
$cboSwitch = New-Object System.Windows.Forms.ComboBox
$cboSwitch.Location = '110,14'; $cboSwitch.Size = '200,24'; $cboSwitch.DropDownStyle = 'DropDown'

$lblNic = New-Object System.Windows.Forms.Label
$lblNic.Text = 'Physical NIC'; $lblNic.Location = '330,18'; $lblNic.AutoSize = $true
$cboNic = New-Object System.Windows.Forms.ComboBox
$cboNic.Location = '415,14'; $cboNic.Size = '180,24'; $cboNic.DropDownStyle = 'DropDown'

$btnRefresh = New-Object System.Windows.Forms.Button
$btnRefresh.Text = 'Read host'; $btnRefresh.Location = '610,13'; $btnRefresh.Size = '140,26'
$form.Controls.AddRange(@($lblSwitch, $cboSwitch, $lblNic, $cboNic, $btnRefresh))

# VLAN list
$list = New-Object System.Windows.Forms.ListView
$list.Location = '16,52'; $list.Size = '734,330'
$list.View = 'Details'; $list.FullRowSelect = $true; $list.GridLines = $true
$list.Anchor = 'Top,Left,Right'
$null = $list.Columns.Add('Adapter name', 200)
$null = $list.Columns.Add('VLAN', 70)
$null = $list.Columns.Add('Mode', 90)
$null = $list.Columns.Add('IP / DHCP', 180)
$null = $list.Columns.Add('Gateway', 120)
$null = $list.Columns.Add('DNS', 160)
$form.Controls.Add($list)

# Row buttons
$btnAdd = New-Object System.Windows.Forms.Button
$btnAdd.Text = 'Add…'; $btnAdd.Location = '16,392'; $btnAdd.Size = '90,28'
$btnEdit = New-Object System.Windows.Forms.Button
$btnEdit.Text = 'Edit…'; $btnEdit.Location = '112,392'; $btnEdit.Size = '90,28'
$btnRemove = New-Object System.Windows.Forms.Button
$btnRemove.Text = 'Remove'; $btnRemove.Location = '208,392'; $btnRemove.Size = '90,28'
$btnLoad = New-Object System.Windows.Forms.Button
$btnLoad.Text = 'Load config…'; $btnLoad.Location = '520,392'; $btnLoad.Size = '110,28'
$btnSave = New-Object System.Windows.Forms.Button
$btnSave.Text = 'Save config…'; $btnSave.Location = '640,392'; $btnSave.Size = '110,28'
$form.Controls.AddRange(@($btnAdd, $btnEdit, $btnRemove, $btnLoad, $btnSave))

# Log pane
$log = New-Object System.Windows.Forms.TextBox
$log.Location = '16,430'; $log.Size = '734,120'; $log.Multiline = $true
$log.ScrollBars = 'Vertical'; $log.ReadOnly = $true; $log.Anchor = 'Top,Bottom,Left,Right'
$log.Font = New-Object System.Drawing.Font('Consolas', 9)
$form.Controls.Add($log)

# Bottom action buttons
$btnPreview = New-Object System.Windows.Forms.Button
$btnPreview.Text = 'Preview changes'; $btnPreview.Location = '16,560'; $btnPreview.Size = '150,32'
$btnApply = New-Object System.Windows.Forms.Button
$btnApply.Text = 'Apply to host'; $btnApply.Location = '174,560'; $btnApply.Size = '150,32'
$btnApply.BackColor = [System.Drawing.Color]::FromArgb(59, 111, 224)
$btnApply.ForeColor = [System.Drawing.Color]::White
$btnTeardown = New-Object System.Windows.Forms.Button
$btnTeardown.Text = 'Teardown…'; $btnTeardown.Location = '332,560'; $btnTeardown.Size = '120,32'
$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = 'Close'; $btnClose.Location = '660,560'; $btnClose.Size = '90,32'; $btnClose.DialogResult = 'Cancel'
$form.Controls.AddRange(@($btnPreview, $btnApply, $btnTeardown, $btnClose))
$btnPreview.Anchor = 'Bottom,Left'; $btnApply.Anchor = 'Bottom,Left'
$btnTeardown.Anchor = 'Bottom,Left'; $btnClose.Anchor = 'Bottom,Right'

# --- helpers ---------------------------------------------------------------
function Write-Log($text) {
    $log.AppendText(($text -replace "`r?`n", "`r`n"))
    $log.AppendText("`r`n")
}
function Set-Log($text) { $log.Clear(); Write-Log $text }

function Render-List {
    $list.Items.Clear()
    foreach ($v in $script:Vlans) {
        $it = New-Object System.Windows.Forms.ListViewItem([string]$v.Name)
        $null = $it.SubItems.Add($(if ($v.Tagged) { [string]$v.VlanId } else { '—' }))
        $null = $it.SubItems.Add($(if ($v.Tagged) { 'Tagged' } else { 'Untagged' }))
        $null = $it.SubItems.Add($(if ($v.Dhcp) { 'DHCP' } elseif ($v.IPAddress) { "$($v.IPAddress)/$($v.PrefixLength)" } else { '(none)' }))
        $null = $it.SubItems.Add([string]$v.Gateway)
        $null = $it.SubItems.Add((@($v.DnsServers) -join ', '))
        $null = $list.Items.Add($it)
    }
}

function Get-SelectedIndex {
    if ($list.SelectedIndices.Count -eq 0) { return -1 }
    return $list.SelectedIndices[0]
}

function Test-Rows {
    $names = @{}; $untagged = 0
    foreach ($v in $script:Vlans) {
        if (-not $v.Name) { return 'Every adapter needs a name.' }
        if ($names[$v.Name]) { return "Duplicate adapter name: $($v.Name)" }
        $names[$v.Name] = $true
        if ($v.Name -eq $cboSwitch.Text.Trim()) { return "An adapter can't be named the same as the switch." }
        if (-not $v.Tagged) { $untagged++ }
        if (-not $v.Dhcp -and (-not $v.IPAddress -or -not $v.PrefixLength)) {
            return "$($v.Name): set an IP + prefix, or turn on DHCP."
        }
    }
    if ($untagged -gt 1) { return 'Only one adapter can be untagged (the native network).' }
    return $null
}

function Invoke-Engine([switch]$WhatIf, [switch]$Teardown) {
    $err = Test-Rows
    if ($err) { [System.Windows.Forms.MessageBox]::Show($err, 'VLAN Manager', 'OK', 'Warning') | Out-Null; return }
    $sw = $cboSwitch.Text.Trim()
    if (-not $sw) { [System.Windows.Forms.MessageBox]::Show('Enter a virtual switch name.', 'VLAN Manager', 'OK', 'Warning') | Out-Null; return }

    # Creating a brand-new switch needs a physical NIC; if the named switch isn't
    # one we already saw on the host, make the user pick a NIC (the engine would
    # otherwise prompt on a console this GUI doesn't have).
    $existingSwitch = @($cboSwitch.Items) -contains $sw
    if (-not $Teardown -and -not $existingSwitch -and -not $cboNic.Text.Trim()) {
        [System.Windows.Forms.MessageBox]::Show(
            "Switch '$sw' doesn't exist yet, so pick a Physical NIC to bind it to (top-right).",
            'VLAN Manager', 'OK', 'Warning') | Out-Null
        return
    }

    $tmp = Join-Path $env:TEMP ("vlanmgr-{0}.json" -f ([guid]::NewGuid().ToString('N')))
    ConvertTo-ConfigJson $script:Vlans | Set-Content -Path $tmp -Encoding UTF8

    # Splat into the engine IN-PROCESS and merge every stream (*>&1) so Write-Host
    # progress lines are captured — a child powershell.exe would lose them.
    $cmd = @{ ConfigPath = $tmp; SwitchName = $sw }
    if ($cboNic.Text.Trim()) { $cmd.PhysicalAdapterName = $cboNic.Text.Trim() }
    if ($Teardown) { $cmd.Teardown = $true }

    Set-Log ("$(if ($Teardown) { 'Teardown' } elseif ($WhatIf) { 'Preview (no changes made)' } else { 'Applying…' })`r`n")
    $form.Enabled = $false
    [System.Windows.Forms.Application]::DoEvents()
    try {
        $out = & $EngineScript @cmd -WhatIf:$WhatIf *>&1 | Out-String
        Write-Log $out
    } catch {
        Write-Log "ERROR: $($_.Exception.Message)"
    } finally {
        Remove-Item $tmp -ErrorAction SilentlyContinue
        $form.Enabled = $true
    }
    if (-not $WhatIf) {
        # Re-read live state so the list reflects what's actually on the host now.
        try { $script:Vlans = Read-LiveVlans; Render-List } catch {}
    }
}

# --- wire up events --------------------------------------------------------
$btnRefresh.Add_Click({
    try {
        $script:Vlans = Read-LiveVlans
        Render-List
        $names = Get-ExternalSwitchNames
        $cboSwitch.Items.Clear(); $cboSwitch.Items.AddRange([object[]]$names)
        if ($names.Count -and -not $cboSwitch.Text) { $cboSwitch.Text = $names[0] }
        $nics = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
            Where-Object Status -eq 'Up' | Select-Object -ExpandProperty Name)
        $cboNic.Items.Clear(); $cboNic.Items.AddRange([object[]]$nics)
        Set-Log ("Read {0} VLAN adapter(s) from the host." -f $script:Vlans.Count)
    } catch {
        Set-Log "Couldn't read the host: $($_.Exception.Message)`r`nIs Hyper-V installed and enabled?"
    }
})

$btnAdd.Add_Click({
    $row = Show-VlanDialog $null
    if ($row) { $script:Vlans = @($script:Vlans) + $row; Render-List }
})
$btnEdit.Add_Click({
    $i = Get-SelectedIndex
    if ($i -lt 0) { return }
    $row = Show-VlanDialog $script:Vlans[$i]
    if ($row) { $script:Vlans[$i] = $row; Render-List }
})
$list.Add_DoubleClick({ $btnEdit.PerformClick() })
$btnRemove.Add_Click({
    $i = Get-SelectedIndex
    if ($i -lt 0) { return }
    # Rebuild by index (identical hashtables aren't safely comparable with -ne).
    $kept = @(); for ($j = 0; $j -lt $script:Vlans.Count; $j++) { if ($j -ne $i) { $kept += $script:Vlans[$j] } }
    $script:Vlans = @($kept)
    Render-List
})

$btnLoad.Add_Click({
    $ofd = New-Object System.Windows.Forms.OpenFileDialog
    $ofd.Filter = 'VLAN config (*.json)|*.json|All files (*.*)|*.*'
    if ($ofd.ShowDialog() -eq 'OK') {
        try {
            $script:Vlans = ConvertFrom-ConfigJson $ofd.FileName
            Render-List
            Set-Log ("Loaded {0} VLAN(s) from {1}." -f $script:Vlans.Count, $ofd.FileName)
        } catch {
            Set-Log "Couldn't read that config: $($_.Exception.Message)"
        }
    }
})
$btnSave.Add_Click({
    $sfd = New-Object System.Windows.Forms.SaveFileDialog
    $sfd.Filter = 'VLAN config (*.json)|*.json'
    $sfd.FileName = 'vlans.json'
    if ($sfd.ShowDialog() -eq 'OK') {
        ConvertTo-ConfigJson $script:Vlans | Set-Content -Path $sfd.FileName -Encoding UTF8
        Set-Log ("Saved {0} VLAN(s) to {1}." -f $script:Vlans.Count, $sfd.FileName)
    }
})

$btnPreview.Add_Click({ Invoke-Engine -WhatIf })
$btnApply.Add_Click({
    $msg = "Apply these $($script:Vlans.Count) VLAN adapter(s) to switch '$($cboSwitch.Text.Trim())'?`n`n" +
           "This changes the host's live networking and may briefly drop the network on the bound NIC."
    if ([System.Windows.Forms.MessageBox]::Show($msg, 'Apply to host', 'OKCancel', 'Warning') -eq 'OK') {
        Invoke-Engine
    }
})
$btnTeardown.Add_Click({
    $msg = "Remove the listed host adapters and the switch '$($cboSwitch.Text.Trim())'?`n`nThis cannot be undone."
    if ([System.Windows.Forms.MessageBox]::Show($msg, 'Teardown', 'OKCancel', 'Warning') -eq 'OK') {
        Invoke-Engine -Teardown
    }
})

# Populate on open.
$btnRefresh.PerformClick()
Set-Log "Ready. 'Read host' shows the VLANs that are there now. Add/Edit/Remove, then Preview and Apply."

[void]$form.ShowDialog()
