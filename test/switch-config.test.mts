import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateSwitchConfig } from '../src/main/switch-config.ts'

const OPTS = {
  baseTemplate: '{{VLANS}}\n{{USERS}}\n{{LAGS}}\n{{SYSNAME}}\n{{INTERFACES}}\n{{MGMT}}\n',
  adminUser: 'admin',
  adminPassword: 'secret'
}
const subnet = (id: number, name: string, vlan: string | null, cidr: string): never =>
  ({ id, name, vlan, cidr, gateway: null, notes: null }) as never
const port = (id: number, untagged: number | null, tagged: number[] = [], over = {}): never =>
  ({
    id,
    label: String(id),
    ipAddress: null,
    untaggedSubnetId: untagged,
    taggedSubnetIds: tagged,
    isUnused: false,
    lagGroup: null,
    ...over
  }) as never
const device = (ports: never[], over = {}): never =>
  ({ id: 1, name: 'SW1', isSwitch: true, managementIp: null, oobIp: null, ports, ...over }) as never

const SUBNETS = [subnet(1, 'Dante', '10', '10.0.10.0/24'), subnet(2, 'Control', '20', '10.0.20.0/24')]

test('a normal switch', () => {
  const cfg = generateSwitchConfig(
    device([port(1, 1), port(2, 2, [1])], { managementIp: '10.0.20.5' }),
    SUBNETS,
    OPTS
  )
  assert.match(cfg, /^vlan 10,20$/m)
  assert.match(cfg, /^vlan name 10 "Dante"$/m)
  assert.match(cfg, /username "admin" password secret level 15/)
  assert.match(cfg, /interface 1\/0\/2\n[^\n]*\nvlan pvid 20\nvlan participation exclude 1\nvlan participation include 10,20\nvlan tagging 10\n/)
  assert.match(cfg, /^ip management vlan 20 10\.0\.20\.5 255\.255\.255\.0$/m)
  assert.doesNotMatch(cfg, /CHECK/)
})

test('a not-needed jack takes no number on the switch', () => {
  const cfg = generateSwitchConfig(
    device([port(1, 1), port(2, 1, [], { isUnused: true }), port(3, 2)]),
    SUBNETS,
    OPTS
  )
  assert.match(cfg, /! Port 3\ninterface 1\/0\/2\n/)
  assert.doesNotMatch(cfg, /interface 1\/0\/3/)
})

test('the native VLAN is never also tagged', () => {
  const cfg = generateSwitchConfig(device([port(1, 2, [2])]), SUBNETS, OPTS)
  assert.match(cfg, /vlan pvid 20/)
  assert.doesNotMatch(cfg, /vlan tagging/)
})

test('bad VLANs stay out of the VLAN line and are flagged', () => {
  const cfg = generateSwitchConfig(
    device([]),
    [...SUBNETS, subnet(3, 'Big', '5000', '10.0.50.0/24'), subnet(4, 'Word', '10a', '10.0.60.0/24'), subnet(5, 'Twin', '10', '10.0.70.0/24'), subnet(6, 'One', '1', '10.0.80.0/24')],
    OPTS
  )
  assert.match(cfg, /^vlan 10,20$/m)
  assert.equal(cfg.match(/vlan name 10 /g)?.length, 1)
  assert.doesNotMatch(cfg, /vlan name 1 /)
  assert.match(cfg, /! CHECK: Subnet "Big" has VLAN "5000"/)
  assert.match(cfg, /! CHECK: Subnet "Word" has VLAN "10a"/)
  assert.match(cfg, /! CHECK: VLAN 10 is on more than one subnet/)
})

test('names and passwords can not break a CLI line', () => {
  const cfg = generateSwitchConfig(device([]), [subnet(1, 'Dante "A"\nexit', '10', '10.0.10.0/24')], {
    ...OPTS,
    adminPassword: 'p w'
  })
  assert.match(cfg, /^vlan name 10 "Dante Aexit"$/m)
  assert.doesNotMatch(cfg, /username/)
  assert.match(cfg, /! CHECK: The admin password/)
})

test('the management VLAN is never guessed', () => {
  const noSubnet = generateSwitchConfig(device([], { managementIp: '192.168.1.5' }), SUBNETS, OPTS)
  assert.doesNotMatch(noSubnet, /ip management/)
  assert.match(noSubnet, /! CHECK: Management IP/)
  const narrowest = generateSwitchConfig(
    device([], { managementIp: '10.0.20.5' }),
    [subnet(9, 'All', '99', '10.0.0.0/8'), ...SUBNETS],
    OPTS
  )
  assert.match(narrowest, /^ip management vlan 20 10\.0\.20\.5 255\.255\.255\.0$/m)
})

const MON = { logServers: '10.0.20.50', syslogPort: 514, snmpCommunity: 'showro', m4300Snmp: false, poeAlerts: false }
const mgmt = { managementIp: '10.0.20.5' }

test('monitoring points the switch at the logging server and sets SNMP', () => {
  const cfg = generateSwitchConfig(device([], mgmt), SUBNETS, {
    ...OPTS,
    baseTemplate: 'configure\n{{MONITORING}}\n{{MGMT}}\nexit\n',
    monitoring: MON
  })
  assert.match(cfg, /^snmp-server community showro ro$/m)
  assert.match(cfg, /^logging host 10\.0\.20\.50 ipv4 514 6\nlogging syslog$/m)
  assert.doesNotMatch(cfg, /poe|CHECK/)
})

test('a template saved before monitoring existed still gets it, before the interfaces', () => {
  const cfg = generateSwitchConfig(device([port(1, 1)], mgmt), SUBNETS, { ...OPTS, monitoring: MON })
  assert.ok(cfg.indexOf('logging host') < cfg.indexOf('interface 1/0/1'))
})

test('M4300 firmware 12 gets the three-step community, and PoE is opt-in', () => {
  const cfg = generateSwitchConfig(device([], mgmt), SUBNETS, {
    ...OPTS,
    baseTemplate: '{{MONITORING}}\n',
    monitoring: { ...MON, m4300Snmp: true, poeAlerts: true }
  })
  assert.match(cfg, /^snmp-server community showro\nsnmp-server community ro showro\nsnmp-server community mode showro$/m)
  assert.doesNotMatch(cfg, /community showro ro/)
  assert.match(cfg, /^poe usagethreshold all 85\npoe traps$/m)
})

test('several logging servers, and a bad one is flagged', () => {
  const cfg = generateSwitchConfig(device([], mgmt), SUBNETS, {
    ...OPTS,
    baseTemplate: '{{MONITORING}}\n',
    monitoring: { ...MON, logServers: '10.0.20.50, 10.0.20.51 nope' }
  })
  assert.equal(cfg.match(/logging host/g)?.length, 2)
  assert.equal(cfg.match(/logging syslog/g)?.length, 1)
  assert.match(cfg, /! CHECK: Logging server "nope"/)
})

test('crew copies leave the community out without raising a false alarm', () => {
  const cfg = generateSwitchConfig(device([], mgmt), SUBNETS, {
    ...OPTS,
    baseTemplate: '{{MONITORING}}\n',
    monitoring: MON,
    crewCopy: true
  })
  assert.doesNotMatch(cfg, /showro|CHECK/)
  assert.match(cfg, /logging host/)
})

test('monitoring that can not work is flagged', () => {
  const noMgmt = generateSwitchConfig(device([]), SUBNETS, { ...OPTS, monitoring: MON })
  assert.match(noMgmt, /! CHECK: No management IP/)
  const routed = generateSwitchConfig(device([], mgmt), SUBNETS, {
    ...OPTS,
    monitoring: { ...MON, logServers: '192.168.5.5' }
  })
  assert.match(routed, /! CHECK: Logging server 192\.168\.5\.5 is outside Control/)
  const badCommunity = generateSwitchConfig(device([], mgmt), SUBNETS, {
    ...OPTS,
    baseTemplate: '{{MONITORING}}\n',
    monitoring: { ...MON, snmpCommunity: 'a b' }
  })
  assert.doesNotMatch(badCommunity, /snmp-server community a/)
  assert.match(badCommunity, /! CHECK: The SNMP community/)
})

test('no monitoring set up adds nothing', () => {
  const cfg = generateSwitchConfig(device([], mgmt), SUBNETS, {
    ...OPTS,
    monitoring: { ...MON, logServers: '', snmpCommunity: '' }
  })
  assert.doesNotMatch(cfg, /logging|snmp-server community|CHECK/)
})
