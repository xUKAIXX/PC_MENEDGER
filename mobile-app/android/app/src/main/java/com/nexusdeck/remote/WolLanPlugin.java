package com.nexusdeck.remote;

import android.content.Context;
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
import java.io.InputStreamReader;
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
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "WolLan")
public class WolLanPlugin extends Plugin {

    private byte[] parseMac(String mac) {
        String clean = mac.trim().replace("-", ":").toUpperCase();
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

    private Set<String> collectBroadcastTargets(String hintBroadcast) {
        Set<String> targets = new LinkedHashSet<>();
        targets.add("255.255.255.255");
        if (hintBroadcast != null && !hintBroadcast.trim().isEmpty()) {
            targets.add(hintBroadcast.trim());
        }
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            while (ifaces != null && ifaces.hasMoreElements()) {
                NetworkInterface ni = ifaces.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
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

    private List<String> getLocalIpv4Prefixes() {
        List<String> prefixes = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            while (ifaces != null && ifaces.hasMoreElements()) {
                NetworkInterface ni = ifaces.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress addr = addrs.nextElement();
                    if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                        String ip = addr.getHostAddress();
                        if (ip != null && !ip.startsWith("169.254.")) {
                            int lastDot = ip.lastIndexOf('.');
                            if (lastDot > 0) {
                                String prefix = ip.substring(0, lastDot + 1);
                                if (!prefixes.contains(prefix)) {
                                    prefixes.add(prefix);
                                }
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        return prefixes;
    }

    @PluginMethod
    public void wake(PluginCall call) {
        JSArray macsArray = call.getArray("macs");
        String broadcastIp = call.getString("broadcastIp", "255.255.255.255");

        if (macsArray == null || macsArray.length() == 0) {
            call.reject("MAC address required");
            return;
        }

        new Thread(() -> {
            int sentCount = 0;
            Set<String> targets = collectBroadcastTargets(broadcastIp);
            int[] ports = new int[] { 9, 7 };

            try (DatagramSocket socket = new DatagramSocket()) {
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
        }).start();
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

        new Thread(() -> {
            Map<String, JSObject> foundMap = Collections.synchronizedMap(new LinkedHashMap<>());

            // Phase 1: Instant UDP Broadcast Discovery (port 7789)
            try (DatagramSocket udp = new DatagramSocket()) {
                udp.setBroadcast(true);
                udp.setSoTimeout(380);
                byte[] probe = "NEXUS_DISCOVER_V1".getBytes(StandardCharsets.UTF_8);

                for (String target : collectBroadcastTargets(null)) {
                    try {
                        InetAddress addr = InetAddress.getByName(target);
                        udp.send(new DatagramPacket(probe, probe.length, addr, udpPort));
                    } catch (Exception ignored) {}
                }

                long deadline = System.currentTimeMillis() + 420;
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

            // Phase 2: Fast parallel /24 TCP sweep fallback if router blocked UDP broadcast
            if (foundMap.isEmpty()) {
                List<String> prefixes = getLocalIpv4Prefixes();
                if (!prefixes.isEmpty()) {
                    String prefix = prefixes.get(0);
                    ExecutorService pool = Executors.newFixedThreadPool(48);
                    for (int hostNum = 1; hostNum <= 254; hostNum++) {
                        final String candidateIp = prefix + hostNum;
                        pool.submit(() -> {
                            try (Socket sock = new Socket()) {
                                sock.connect(new InetSocketAddress(candidateIp, httpPort), 260);
                            } catch (Exception e) {
                                return;
                            }
                            HttpURLConnection conn = null;
                            try {
                                URL url = new URL("http://" + candidateIp + ":" + httpPort + "/api/ping");
                                conn = (HttpURLConnection) url.openConnection();
                                conn.setConnectTimeout(600);
                                conn.setReadTimeout(700);
                                conn.setRequestMethod("GET");
                                if (conn.getResponseCode() == 200) {
                                    StringBuilder sb = new StringBuilder();
                                    try (BufferedReader br = new BufferedReader(
                                        new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8)
                                    )) {
                                        String line;
                                        while ((line = br.readLine()) != null) {
                                            sb.append(line);
                                        }
                                    }
                                    JSONObject json = new JSONObject(sb.toString());
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
                        pool.awaitTermination(2800, TimeUnit.MILLISECONDS);
                    } catch (InterruptedException ignored) {}
                }
            }

            JSArray hostsArray = new JSArray();
            for (JSObject h : foundMap.values()) {
                hostsArray.put(h);
            }
            JSObject result = new JSObject();
            result.put("hosts", hostsArray);
            call.resolve(result);
        }).start();
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
