const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const TUNNEL_NAME = /vpn|tunnel|tailscale|wireguard|zerotier|openvpn|tap\d*|tun\d*|wintun|anyconnect|global.?protect|proton/i;
let windowsSnapshotPromise;

function isTunnel(name, description = "") {
  return TUNNEL_NAME.test(`${name} ${description}`);
}

async function run(command, args) {
  const { stdout } = await execFileAsync(command, args, {
    timeout: 10000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true
  });
  return stdout;
}

function parseJsonArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

const WINDOWS_SNAPSHOT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$addresses = @(Get-NetIPAddress -ErrorAction SilentlyContinue)",
  "$interfaces = @(Get-NetAdapter | ForEach-Object { $adapter = $_; [pscustomobject]@{ name = $adapter.Name; description = $adapter.InterfaceDescription; status = [string]$adapter.Status; index = $adapter.ifIndex; addresses = @($addresses | Where-Object InterfaceIndex -eq $adapter.ifIndex | ForEach-Object IPAddress) } })",
  "$routes = @(Get-NetRoute -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ destination = [string]$_.DestinationPrefix; gateway = [string]$_.NextHop; interface = [string]$_.InterfaceAlias; metric = $_.RouteMetric } })",
  "$tcp = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ protocol = 'TCP'; address = [string]$_.LocalAddress; port = $_.LocalPort; pid = $_.OwningProcess } })",
  "$udp = @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ protocol = 'UDP'; address = [string]$_.LocalAddress; port = $_.LocalPort; pid = $_.OwningProcess } })",
  "[pscustomobject]@{ interfaces = $interfaces; routes = $routes; ports = @($tcp) + @($udp) } | ConvertTo-Json -Depth 5 -Compress"
].join("; ");

function getWindowsSnapshot() {
  if (!windowsSnapshotPromise) {
    const executable = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    windowsSnapshotPromise = run(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_SNAPSHOT_SCRIPT])
      .then((output) => JSON.parse(output.trim()));
    const reset = () => setTimeout(() => { windowsSnapshotPromise = undefined; }, 1000).unref();
    windowsSnapshotPromise.then(reset, reset);
  }
  return windowsSnapshotPromise;
}

function getGenericInterfaces() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) => {
    const assignedAddresses = (addresses || []).map((address) => address.address);
    if (assignedAddresses.length === 0) return [];
    return [{
      name,
      description: name,
      status: "Up",
      addresses: assignedAddresses,
      tunnel: isTunnel(name)
    }];
  });
}

function ipv6HexToAddress(value) {
  const groups = value.match(/.{4}/g).map((group) => Number.parseInt(group, 16).toString(16));
  if (net.isIP(groups.join(":")) !== 6) return groups.join(":");
  let bestStart = -1;
  let bestLength = 1;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== "0") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === "0") end += 1;
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  if (bestStart < 0) return groups.join(":");
  const left = groups.slice(0, bestStart).join(":");
  const right = groups.slice(bestStart + bestLength).join(":");
  return `${left}::${right}`;
}

function parseLinuxIpv6Routes(text) {
  return text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [destination, prefix, , , gateway, metric, , , flags, iface] = line.trim().split(/\s+/);
    if (!destination || !prefix || !gateway || !iface) return [];
    return [{
      destination: `${ipv6HexToAddress(destination)}/${Number.parseInt(prefix, 16)}`,
      gateway: ipv6HexToAddress(gateway),
      interface: iface,
      metric: Number.parseInt(metric, 16) || 0,
      active: (Number.parseInt(flags, 16) & 1) !== 0
    }];
  });
}

function hexToIpv4(value) {
  const number = Number.parseInt(value, 16) >>> 0;
  return [number & 255, (number >>> 8) & 255, (number >>> 16) & 255, (number >>> 24) & 255].join(".");
}

function maskToPrefix(mask) {
  return mask.split(".").reduce((total, octet) => total + (Number(octet).toString(2).match(/1/g) || []).length, 0);
}

function parseLinuxRoutes(text) {
  return text.split(/\r?\n/).slice(1).filter(Boolean).flatMap((line) => {
    const [iface, destination, gateway, flags, , , metric, mask] = line.trim().split(/\s+/);
    if (!iface || !destination || !mask) return [];
    return [{
      destination: `${hexToIpv4(destination)}/${maskToPrefix(hexToIpv4(mask))}`,
      gateway: gateway ? hexToIpv4(gateway) : "0.0.0.0",
      interface: iface,
      metric: Number(metric) || 0,
      active: (parseInt(flags, 16) & 1) !== 0
    }];
  });
}

function parseSsOutput(text, protocol) {
  return text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    const local = fields[3];
    if (!local) return [];
    const match = local.match(/^(.*):(\d+)$/);
    if (!match) return [];
    const pidMatch = line.match(/pid=(\d+)/);
    return [{
      protocol,
      address: match[1].replace(/^\[|\]$/g, ""),
      port: Number(match[2]),
      pid: pidMatch ? Number(pidMatch[1]) : null
    }];
  });
}

async function getLinuxPorts() {
  const [tcp, udp] = await Promise.all([
    run("ss", ["-H", "-l", "-t", "-n", "-p"]),
    run("ss", ["-H", "-l", "-u", "-n", "-p"])
  ]);
  return [...parseSsOutput(tcp, "TCP"), ...parseSsOutput(udp, "UDP")];
}

function parseLsofOutput(text, protocol) {
  return text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 9 || fields[0] === "COMMAND") return [];
    const match = fields[8].replace(/\(.*\)$/, "").match(/^(.*):(\d+)$/);
    if (!match) return [];
    return [{
      protocol,
      address: match[1].replace(/^\[|\]$/g, ""),
      port: Number(match[2]),
      pid: Number(fields[1]) || null
    }];
  });
}

async function getMacPorts() {
  const [tcp, udp] = await Promise.all([
    run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"]),
    run("lsof", ["-nP", "-iUDP"])
  ]);
  return [...parseLsofOutput(tcp, "TCP"), ...parseLsofOutput(udp, "UDP")];
}

async function getInterfaces() {
  if (process.platform === "win32") {
    const snapshot = await getWindowsSnapshot();
    return parseJsonArray(snapshot.interfaces).map((adapter) => ({
      name: adapter.name,
      description: adapter.description,
      status: adapter.status,
      addresses: parseJsonArray(adapter.addresses),
      tunnel: isTunnel(adapter.name, adapter.description)
    }));
  }
  const interfaces = getGenericInterfaces();
  if (process.platform !== "linux") return interfaces;
  return Promise.all(interfaces.map(async (item) => {
    let status = "Unknown";
    try {
      const state = await fs.readFile(`/sys/class/net/${item.name}/operstate`, "utf8");
      status = state.trim() === "down" ? "Down" : "Up";
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return { ...item, status, tunnel: isTunnel(item.name) };
  }));
}

async function getRoutes() {
  if (process.platform === "win32") return parseJsonArray((await getWindowsSnapshot()).routes);
  if (process.platform === "linux") {
    const [ipv4, ipv6] = await Promise.all([
      fs.readFile("/proc/net/route", "utf8"),
      fs.readFile("/proc/net/ipv6_route", "utf8")
    ]);
    return [...parseLinuxRoutes(ipv4), ...parseLinuxIpv6Routes(ipv6)];
  }
  const output = await run("netstat", ["-rn", "-f", "inet"]);
  return output.split(/\r?\n/).filter((line) => /^\s*(default|\d{1,3}(?:\.\d{1,3}){3})\s/.test(line)).map((line) => {
    const fields = line.trim().split(/\s+/);
    return { destination: fields[0], gateway: fields[1], interface: fields[5] || "", metric: null };
  });
}

const WINDOWS_TRAFFIC_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Get-NetAdapterStatistics | Select-Object Name, ReceivedBytes, SentBytes, ReceivedUnicastPackets, SentUnicastPackets, InboundErrors, OutboundErrors | ConvertTo-Json -Compress"
].join("; ");

async function getTrafficCounters() {
  if (process.platform === "win32") {
    const executable = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    const output = await run(executable, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_TRAFFIC_SCRIPT
    ]);
    const adapters = parseJsonArray(JSON.parse(output.trim() || "[]"));
    return {
      supported: true,
      sampledAt: Date.now(),
      interfaces: adapters.map((item) => ({
        name: String(item.Name || "Unknown"),
        bytesReceived: Number(item.ReceivedBytes) || 0,
        bytesSent: Number(item.SentBytes) || 0,
        packetsReceived: Number(item.ReceivedUnicastPackets) || 0,
        packetsSent: Number(item.SentUnicastPackets) || 0,
        errorsIn: Number(item.InboundErrors) || 0,
        errorsOut: Number(item.OutboundErrors) || 0
      }))
    };
  }

  if (process.platform === "linux") {
    const names = await fs.readdir("/sys/class/net");
    const interfaces = await Promise.all(names.map(async (name) => {
      const base = path.join("/sys/class/net", name, "statistics");
      const readCounter = async (counter) =>
        Number((await fs.readFile(path.join(base, counter), "utf8")).trim()) || 0;
      const [bytesReceived, bytesSent, packetsReceived, packetsSent, errorsIn, errorsOut] =
        await Promise.all([
          readCounter("rx_bytes"), readCounter("tx_bytes"),
          readCounter("rx_packets"), readCounter("tx_packets"),
          readCounter("rx_errors"), readCounter("tx_errors")
        ]);
      return { name, bytesReceived, bytesSent, packetsReceived, packetsSent, errorsIn, errorsOut };
    }));
    return { supported: true, sampledAt: Date.now(), interfaces };
  }

  return { supported: false, sampledAt: Date.now(), interfaces: [] };
}

async function getPorts() {
  if (process.platform === "win32") return parseJsonArray((await getWindowsSnapshot()).ports);
  return process.platform === "linux" ? getLinuxPorts() : getMacPorts();
}

module.exports = {
  getInterfaces,
  getPorts,
  getRoutes,
  getTrafficCounters,
  isTunnel,
  parseLinuxIpv6Routes,
  parseLinuxRoutes,
  parseSsOutput
};
