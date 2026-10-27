package com.nexusdeck.remote;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "WolLan")
public class WolLanPlugin extends Plugin {

    private final ExecutorService ioPool = Executors.newCachedThreadPool();

    /**
     * Finds the active physical Wi-Fi or Ethernet Network on Android, bypassing any active VPN tunnel (tun0).
     */
    private Network findPhysicalLanNetwork() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return null;
            Network ethernetFallback = null;
            for (Network net : cm.getAllNetworks()) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(net);
                if (caps == null) continue;
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue;
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                    return net;
                }
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                    ethernetFallback = net;
                }
            }
            return ethernetFallback;
        } catch (Exception ignored) {
            return null;
        }
    }

    private boolean isTunnelOrCellularInterface(String name) {
        if (name == null) return true;
        String lower = name.toLowerCase(Locale.ROOT);
        return lower.startsWith("tun")
            || lower.startsWith("tap")
            || lower.startsWith("ppp")
            || lower.startsWith("wg")
            || lower.startsWith("rmnet")
            || lower.startsWith("ccmni")
            || lower.startsWith("pdp")
            || lower.startsWith("dummy")
            || lower.startsWith("lo");
    }

    private byte[] parseMac(String mac) {
        String clean = mac.trim().replace("-", ":").toUpperCase(Locale.ROOT);
        String[] parts = clean.split(":");
        if (parts.length != 6) return null;
        byte[] bytes = new byte[6];
        try {
            for (int i = 0; i < 6; i++) {
                bytes[i] = (byte) Integer.parseInt(parts[i], 16);
            }
            return bytes;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private byte[] buildMagicPacket(byte[] macBytes) {
        byte[] packet = new byte[6 + 16 * 6];
        for (int i = 0; i < 6; i++) {
            packet[i] = (byte) 0xFF;
        }
        for (int i = 6; i < packet.length; i += 6) {
            System.arraycopy(macBytes, 0, packet, i, 6);
        }
        return packet;
    }

    private Set<String> collectBroadcastTargets(String hintBroadcast, Network lanNet) {
        Set<String> targets = new LinkedHashSet<>();
        targets.add("255.255.255.255");
        if (hintBroadcast != null && !hintBroadcast.trim().isEmpty()) {
            targets.add(hintBroadcast.trim());
        }
        try {
            if (lanNet != null) {
                ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm != null) {
                    LinkProperties lp = cm.getLinkProperties(lanNet);
                    if (lp != null) {
                        for (LinkAddress la : lp.getLinkAddresses()) {
                            InetAddress addr = la.getAddress();
                            if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                                String ip = addr.getHostAddress();
                                if (ip != null) {
                                    int dot = ip.lastIndexOf('.');
                                    if (dot > 0) {
                                        targets.add(ip.substring(0, dot + 1) + "255");
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {}

        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            while (ifaces != null && ifaces.hasMoreElements()) {
                NetworkInterface ni = ifaces.nextElement();
                if (!ni.isUp() || ni.isLoopback() || isTunnelOrCellularInterface(ni.getName())) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress bcast = ia.getBroadcast();
                    if (bcast != null) {
                        targets.add(bcast.getHostAddress());
                    }
                }
            }
        } catch (Exception ignored) {}
        return targets;
    }

    private List<String> getLocalIpv4Prefixes(Network lanNet) {
        Set<String> prefixes = new LinkedHashSet<>();

        // 1. Prefer Wi-Fi / Ethernet LinkProperties directly (never confused by VPN tun0!)
        try {
            if (lanNet != null) {
                ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm != null) {
                    LinkProperties lp = cm.getLinkProperties(lanNet);
                    if (lp != null) {
                        for (LinkAddress la : lp.getLinkAddresses()) {
                            InetAddress addr = la.getAddress();
                            if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                                String ip = addr.getHostAddress();
                                if (ip != null && !ip.startsWith("169.254.")) {
                                    int lastDot = ip.lastIndexOf('.');
                                    if (lastDot > 0) {
                                        prefixes.add(ip.substring(0, lastDot + 1));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {}

        // 2. Also inspect non-VPN, non-cellular NetworkInterfaces (e.g. Wi-Fi Hotspot ap0/wlan1)
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            while (ifaces != null && ifaces.hasMoreElements()) {
                NetworkInterface ni = ifaces.nextElement();
                if (!ni.isUp() || ni.isLoopback() || isTunnelOrCellularInterface(ni.getName())) continue;
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress addr = addrs.nextElement();
                    if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                        String ip = addr.getHostAddress();
                        if (ip != null && !ip.startsWith("169.254.")) {
                            int lastDot = ip.lastIndexOf('.');
                            if (lastDot > 0) {
                                prefixes.add(ip.substring(0, lastDot + 1));
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {}

        return new ArrayList<>(prefixes);
    }

    private HttpURLConnection openHttpConnectionSmart(URL url, Network lanNet, String method, int timeoutMs) throws Exception {
        HttpURLConnection conn;
        if (lanNet != null) {
            try {
                conn = (HttpURLConnection) lanNet.openConnection(url);
            } catch (Exception e) {
                conn = (HttpURLConnection) url.openConnection();
            }
        } else {
            conn = (HttpURLConnection) url.openConnection();
        }
        String safeMethod = "PATCH".equalsIgnoreCase(method) ? "PUT" : method.toUpperCase(Locale.ROOT);
        conn.setRequestMethod(safeMethod);
        conn.setConnectTimeout(timeoutMs);
        conn.setReadTimeout(timeoutMs);
        conn.setUseCaches(false);
        return conn;
    }

    private String readStreamUtf8(InputStream is) throws Exception {
        if (is == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            char[] buf = new char[4096];
            int n;
            while ((n = br.read(buf)) != -1) {
                sb.append(buf, 0, n);
            }
        }
        return sb.toString();
    }

    /**
     * Native HTTP client bound directly to physical Wi-Fi/LAN (bypasses Android VPN & WebView restrictions!)
     */
    @PluginMethod
    public void httpRequest(PluginCall call) {
        final String urlStr = call.getString("url");
        if (urlStr == null || urlStr.trim().isEmpty()) {
            call.reject("url required");
            return;
        }
        final String method = call.getString("method", "GET");
        final JSObject headersObj = call.getObject("headers");
        final String body = call.getString("body", null);
        Integer timeoutArg = call.getInt("timeoutMs", 5000);
        final int timeoutMs = timeoutArg != null ? Math.max(800, timeoutArg) : 5000;

        ioPool.submit(() -> {
            Network lanNet = findPhysicalLanNetwork();
            HttpURLConnection conn = null;
            try {
                URL url = new URL(urlStr);
                try {
                    conn = openHttpConnectionSmart(url, lanNet, method != null ? method : "GET", timeoutMs);
                    applyHeadersAndBody(conn, headersObj, body);
                    int status = conn.getResponseCode();
                    InputStream stream = status >= 200 && status < 400 ? conn.getInputStream() : conn.getErrorStream();
                    String responseText = readStreamUtf8(stream);

                    JSObject res = new JSObject();
                    res.put("status", status);
                    res.put("data", responseText);
                    call.resolve(res);
                    return;
                } catch (Exception firstErr) {
                    if (conn != null) {
                        conn.disconnect();
                        conn = null;
                    }
                    // Fallback to system default network if user is intentionally on a remote WireGuard/Tailscale VPN
                    if (lanNet != null) {
                        conn = openHttpConnectionSmart(url, null, method != null ? method : "GET", timeoutMs);
                        applyHeadersAndBody(conn, headersObj, body);
                        int status = conn.getResponseCode();
                        InputStream stream = status >= 200 && status < 400 ? conn.getInputStream() : conn.getErrorStream();
                        String responseText = readStreamUtf8(stream);

                        JSObject res = new JSObject();
                        res.put("status", status);
                        res.put("data", responseText);
                        call.resolve(res);
                        return;
                    }
                    throw firstErr;
                }
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Network error");
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private void applyHeadersAndBody(HttpURLConnection conn, JSObject headersObj, String body) throws Exception {
        if (headersObj != null) {
            Iterator<String> keys = headersObj.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                String v = headersObj.optString(k, "");
                if (!v.isEmpty()) {
                    conn.setRequestProperty(k, v);
                }
            }
        }
        if (body != null && !body.isEmpty()) {
            conn.setDoOutput(true);
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
                os.flush();
            }
        }
    }

    @PluginMethod
    public void wake(PluginCall call) {
        JSArray macsArray = call.getArray("macs");
        String broadcastIp = call.getString("broadcastIp", "255.255.255.255");

        if (macsArray == null || macsArray.length() == 0) {
            call.reject("MAC address required");
            return;
        }

        ioPool.submit(() -> {
            int sentCount = 0;
            Network lanNet = findPhysicalLanNetwork();
            Set<String> targets = collectBroadcastTargets(broadcastIp, lanNet);
            int[] ports = new int[] { 9, 7 };

            try (DatagramSocket socket = new DatagramSocket()) {
                if (lanNet != null) {
                    try {
                        lanNet.bindSocket(socket);
                    } catch (Exception ignored) {}
                }
                socket.setBroadcast(true);

                for (int attempt = 0; attempt < 3; attempt++) {
                    for (int idx = 0; idx < macsArray.length(); idx++) {
                        String macStr = macsArray.optString(idx, "");
                        byte[] macBytes = parseMac(macStr);
                        if (macBytes == null) continue;
                        byte[] magic = buildMagicPacket(macBytes);

                        for (String host : targets) {
                            try {
                                InetAddress dest = InetAddress.getByName(host);
                                for (int port : ports) {
                                    DatagramPacket dp = new DatagramPacket(magic, magic.length, dest, port);
                                    socket.send(dp);
                                    sentCount++;
                                }
                            } catch (Exception ignored) {}
                        }
                    }
                    if (attempt < 2) {
                        try {
                            Thread.sleep(45);
                        } catch (InterruptedException ignored) {}
                    }
                }

                JSObject res = new JSObject();
                res.put("sentCount", sentCount);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Wake-on-LAN socket error: " + e.getMessage());
            }
        });
    }

    private JSObject parseDiscoveredJson(JSONObject obj, String fallbackIp, int defaultPort) {
        if (!"NEXUS_PC_V1".equals(obj.optString("magic"))) return null;
        JSObject host = new JSObject();
        String ip = fallbackIp != null && !fallbackIp.isEmpty()
            ? fallbackIp
            : obj.optString("ip", obj.optString("primaryIp", ""));
        host.put("serverId", obj.optString("serverId", ip));
        host.put("name", obj.optString("name", ip));
        host.put("hostname", obj.optString("hostname", ip));
        host.put("ip", ip);
        host.put("port", obj.optInt("port", defaultPort));
        String primaryMac = obj.optString("mac", obj.optString("primaryMac", ""));
        host.put("mac", primaryMac);

        JSArray macsJs = new JSArray();
        JSONArray rawMacs = obj.optJSONArray("macs");
        if (rawMacs != null) {
            for (int i = 0; i < rawMacs.length(); i++) {
                String m = rawMacs.optString(i, "");
                if (!m.isEmpty()) macsJs.put(m);
            }
        } else if (!primaryMac.isEmpty()) {
            macsJs.put(primaryMac);
        }
        host.put("macs", macsJs);
        host.put("broadcastIp", obj.optString("broadcastIp", "255.255.255.255"));
        host.put("pinRequired", obj.optBoolean("pinRequired", false));
        return host;
    }

    @PluginMethod
    public void discover(PluginCall call) {
        Integer portArg = call.getInt("port", 7788);
        final int httpPort = portArg != null ? portArg : 7788;
        final int udpPort = httpPort + 1;

        ioPool.submit(() -> {
            final Network lanNet = findPhysicalLanNetwork();
            Map<String, JSObject> foundMap = Collections.synchronizedMap(new LinkedHashMap<>());

            // Phase 1: Instant UDP Broadcast Discovery over physical Wi-Fi (port 7789)
            try (DatagramSocket udp = new DatagramSocket()) {
                if (lanNet != null) {
                    try {
                        lanNet.bindSocket(udp);
                    } catch (Exception ignored) {}
                }
                udp.setBroadcast(true);
                udp.setSoTimeout(380);
                byte[] probe = "NEXUS_DISCOVER_V1".getBytes(StandardCharsets.UTF_8);

                for (String target : collectBroadcastTargets(null, lanNet)) {
                    try {
                        InetAddress addr = InetAddress.getByName(target);
                        udp.send(new DatagramPacket(probe, probe.length, addr, udpPort));
                    } catch (Exception ignored) {}
                }

                long deadline = System.currentTimeMillis() + 450;
                byte[] recvBuf = new byte[4096];
                while (System.currentTimeMillis() < deadline) {
                    try {
                        DatagramPacket pkt = new DatagramPacket(recvBuf, recvBuf.length);
                        udp.receive(pkt);
                        String text = new String(pkt.getData(), 0, pkt.getLength(), StandardCharsets.UTF_8);
                        JSONObject json = new JSONObject(text);
                        String senderIp = pkt.getAddress().getHostAddress();
                        JSObject parsed = parseDiscoveredJson(json, senderIp, httpPort);
                        if (parsed != null && senderIp != null) {
                            foundMap.put(senderIp, parsed);
                        }
                    } catch (SocketTimeoutException ste) {
                        break;
                    } catch (Exception ignored) {}
                }
            } catch (Exception ignored) {}

            // Phase 2: Parallel /24 TCP sweep over physical Wi-Fi (bypasses VPN & routers blocking UDP broadcast)
            if (foundMap.isEmpty()) {
                List<String> prefixes = getLocalIpv4Prefixes(lanNet);
                for (String prefix : prefixes) {
                    ExecutorService pool = Executors.newFixedThreadPool(56);
                    for (int hostNum = 1; hostNum <= 254; hostNum++) {
                        final String candidateIp = prefix + hostNum;
                        pool.submit(() -> {
                            try (Socket sock = (lanNet != null ? lanNet.getSocketFactory().createSocket() : new Socket())) {
                                sock.connect(new InetSocketAddress(candidateIp, httpPort), 260);
                            } catch (Exception e) {
                                return;
                            }
                            HttpURLConnection conn = null;
                            try {
                                URL url = new URL("http://" + candidateIp + ":" + httpPort + "/api/ping");
                                conn = openHttpConnectionSmart(url, lanNet, "GET", 650);
                                if (conn.getResponseCode() == 200) {
                                    String text = readStreamUtf8(conn.getInputStream());
                                    JSONObject json = new JSONObject(text);
                                    JSObject parsed = parseDiscoveredJson(json, candidateIp, httpPort);
                                    if (parsed != null) {
                                        foundMap.put(candidateIp, parsed);
                                    }
                                }
                            } catch (Exception ignored) {
                            } finally {
                                if (conn != null) conn.disconnect();
                            }
                        });
                    }
                    pool.shutdown();
                    try {
                        pool.awaitTermination(2500, TimeUnit.MILLISECONDS);
                    } catch (InterruptedException ignored) {}
                    if (!foundMap.isEmpty()) break;
                }
            }

            JSArray hostsArray = new JSArray();
            for (JSObject h : foundMap.values()) {
                hostsArray.put(h);
            }
            JSObject result = new JSObject();
            result.put("hosts", hostsArray);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void haptic(PluginCall call) {
        Integer durArg = call.getInt("durationMs", 18);
        long ms = durArg != null ? Math.max(5, Math.min(200, durArg)) : 18;
        try {
            Vibrator vib = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
            if (vib != null && vib.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vib.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vib.vibrate(ms);
                }
            }
        } catch (Exception ignored) {}
        call.resolve();
    }
}
