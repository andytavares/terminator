## Summary

The Terminator app runs a Fastify HTTP + WebSocket server (localhost, password-protected) and previously used ngrok to expose that server as a public URL for remote terminal access. With ngrok and Cloudflare blocked by corporate policy, the team needs an alternative that can tunnel that local port to external collaborators, CI systems consuming webhooks, or remote pairing partners. Tailscale is the strongest candidate: it provides both a private mesh (Serve, for tailnet-only sharing) and a public internet relay (Funnel, for external parties), all built on WireGuard with end-to-end encryption and zero-trust ACLs. For scenarios where external parties cannot join the tailnet, Tailscale Funnel or Microsoft Dev Tunnels cover the public-access use case, while SSH reverse tunnels give the highest degree of self-hosted control at the cost of operational overhead. The recommendation is to adopt Tailscale as the primary replacement, with SSH reverse tunnels as the self-hosted fallback for teams whose corporate policies still prohibit third-party cloud coordination servers.

---

## Options Compared

| Option                                  | How it works                                                                                            | Corp-friendly                                                                                                                   | Cost                                                          | Best for                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Tailscale Serve + Funnel                | WireGuard mesh; Serve = tailnet-only, Funnel = public internet via Tailscale relay                      | High — SOC 2 Type II, SSO/Entra, ACL policy files; coordination metadata only touches Tailscale; user data end-to-end encrypted | Free up to 6 users; $8/user/mo (Standard) for unlimited users | Internal team sharing (Serve) + external webhook/CI exposure (Funnel)                   |
| Headscale + Tailscale clients           | Self-hosted open-source replacement for the Tailscale coordination server; clients remain the same      | Very high — no cloud coordination at all; full data sovereignty                                                                 | Free (OSS); requires your own server to run                   | Organizations that cannot allow any external coordination server                        |
| SSH reverse tunnels (self-hosted)       | `ssh -R` forward: remote port on a jump host maps to local service; GatewayPorts exposes it externally  | Very high — uses only your own infrastructure; no third-party cloud                                                             | Cost of a VPS ($5–20/mo); no software license                 | Teams comfortable operating their own infra; airgapped or highly regulated environments |
| Microsoft Dev Tunnels / VS Code Tunnels | Cloud relay on Azure; authenticated via Microsoft Entra ID / GitHub; outbound-only connection from host | Medium-high — Microsoft/Azure enterprise trust; TLS 1.2+ with HSTS; tunnel locked to creator's identity by default              | Free (public preview; quotas apply: 10 tunnels per account)   | Microsoft-shop teams already using Entra ID; VS Code-centric developer pairing          |

---

## Detailed Analysis

### Tailscale Serve and Funnel

Tailscale builds a WireGuard-based mesh network between enrolled devices. The coordination server handles key exchange and topology only — it never sees payload traffic. `tailscale serve` exposes a local port to other members of the tailnet exclusively. `tailscale funnel` goes further, routing traffic from the public internet through Tailscale relay infrastructure to the local device.

Source: https://tailscale.com/kb/1223/funnel
Quote: "Tailscale Funnel lets you route traffic from the broader internet to a local service running on a device in your Tailscale network"

Source: https://tailscale.com/kb/1223/funnel
Quote: "Funnel relay servers do not decrypt the traffic between public devices and your device."

Source: https://tailscale.com/security
Quote: "Your devices' private encryption keys never leave their respective nodes, and our coordination server only collects and exchanges public keys."

**Fit for Terminator:** The Fastify server listens on a configurable port. With `tailscale funnel`, that port can be exposed over HTTPS on one of three allowed ports (443, 8443, 10000). The existing `NgrokManager` in `src/main/remote/ngrok-manager.ts` could be replaced with a `TailscaleFunnelManager` using the same shell-spawn pattern (`tailscale funnel <port>` + parsing stdout). The app's password-based auth and WS ticket system already provide application-layer security on top of whatever tunnel is used.

**Limitation:** Funnel only exposes ports 443, 8443, and 10000 and requires TLS.

Source: https://tailscale.com/kb/1223/funnel
Quote: "Funnel can only listen on ports `443`, `8443`, and `10000`."

**Pricing:** Free plan supports up to 6 users and unlimited devices.

Source: https://tailscale.com/pricing
Quote: "Up to 6 users" on the free tier; Standard plan at $8/user/month for unlimited users.

**ACL governance:** Access rules are enforced locally on each device, with policy managed through the tailnet policy file.

Source: https://tailscale.com/kb/1018/acls
Quote: "Tailscale's access control methodology follows the least privilege and zero trust principles."

**Corporate trust:** SOC 2 Type II certified.

Source: https://tailscale.com/security
Quote: "Tailscale has implemented procedures, policies and controls necessary to meet AICPA's Trust Services Criteria for security, availability, and confidentiality."

---

### Headscale (self-hosted Tailscale coordination server)

Headscale is an open-source reimplementation of the Tailscale coordination server that can be deployed on any Linux server. Teams using Headscale still use the standard Tailscale client on their devices; only the coordination plane changes. This removes any dependency on Tailscale's cloud infrastructure while retaining the same WireGuard data plane and Tailscale client ecosystem.

Source: https://headscale.net/stable/about/faq/
Quote: "Headscale aims to implement a self-hosted, open source alternative to the Tailscale control server."

**Fit for Terminator:** Identical to standard Tailscale from the application's perspective. However, Headscale does not support Tailscale Funnel (public internet exposure). Serve (tailnet-internal) works. For external/webhook exposure you would still need a jump host or a separate mechanism.

**Limitation:** Headscale is explicitly scoped for personal or small open-source organizations.

Source: https://headscale.net/stable/about/faq/
Quote: "a narrow scope, a _single_ Tailscale network (tailnet), suitable for a personal use, or a small open-source organisation."

**Cost:** Free. Requires a server (VPS, on-prem box) to host.

---

### SSH Reverse Tunnels (self-hosted jump host)

SSH's `-R` flag tells a remote server to listen on a port and forward connections back to a local host:port. When combined with `GatewayPorts yes` in `sshd_config`, that remote port becomes accessible to the outside world. A lightweight cloud VPS ($5–6/month) running OpenSSH is the only infrastructure needed.

Source: https://man.openbsd.org/ssh
Quote: "Specifies that connections to the given TCP port or Unix socket on the remote (server) host are to be forwarded to the local side."

The basic command:

```
ssh -R 0.0.0.0:8443:127.0.0.1:<local_port> user@jump-host
```

**Fit for Terminator:** The `NgrokManager` spawns a child process and polls for a URL. The same pattern could spawn an SSH process and derive the URL from the known jump host address. `autossh` can restart on failure, mirroring the `onCrash` callback in the existing manager. WebSocket upgrade headers pass through cleanly over SSH tunnels.

**Limitations:** No built-in TLS termination (must be handled separately with nginx/Caddy on the jump host), no ephemeral URLs (fixed IP/domain), requires maintaining a server and key management.

**Corporate policy friendliness:** Highest of all options — the only external connection is a standard outbound SSH connection to a server the team controls. Many corporate firewall policies whitelist port 22 outbound. No data ever touches a third-party cloud.

---

### Microsoft Dev Tunnels (including VS Code Tunnels)

Microsoft Dev Tunnels are a cloud relay service hosted on Azure. The local dev machine makes an outbound connection to Azure infrastructure, and external parties access the service via a `*.devtunnels.ms` URL. Authentication is tied to Microsoft Entra ID or GitHub accounts.

Source: https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/overview
Quote: "Dev tunnels allow developers to securely share local web services across the internet."

Source: https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/security
Quote: "By default, hosting and connecting to a tunnel requires authentication with the same Microsoft, Microsoft Entra ID, or GitHub account that created the tunnel."

**Security note — TLS termination:** Unlike Tailscale Funnel, Dev Tunnels terminate TLS at the Azure service boundary and re-encrypt internally.

Source: https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/security
Quote: "TLS termination is done at service ingress using service certificates, issued by a Microsoft CA. After TLS termination, header rewriting takes place."

**Preview status:** The service is in public preview without an SLA.

Source: https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/overview
Quote: "This feature is currently in public preview. This preview version is provided without a service-level agreement, and it's not recommended for production workloads."

**Pricing:** Free (public preview). Quota: 10 tunnels registered per account.

Source: https://code.visualstudio.com/docs/remote/tunnels
Quote: "you can have 10 tunnels registered for your account."

**Corporate fit:** Strong in Microsoft-centric shops. Entra tenant-scoped access is a notable enterprise feature.

Source: https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/security
Quote: "Tunnel access can also be extended to your current Microsoft Entra tenant (use `--tenant`) or specific GitHub organizations."

---

## Recommendation

**Primary recommendation: Tailscale Serve + Funnel**

For the Terminator use case — exposing a local Fastify+WebSocket server to collaborators and CI systems — Tailscale is the strongest fit:

1. **Internal team sharing (remote pairing, shared dev builds):** Use `tailscale serve` to expose the local port to tailnet members only. This replaces the ngrok public URL for colleague access, with stronger access control (WireGuard identity + Terminator password auth).

2. **External exposure (webhooks, CI systems, external reviewers):** Use `tailscale funnel` to create a public HTTPS URL. Funnel only allows ports 443, 8443, and 10000, so the Fastify server would need to bind to one of those, or a local proxy on 8443 would forward to the configured port. The existing `NgrokManager` in `src/main/remote/ngrok-manager.ts` can be adapted to spawn `tailscale funnel <port>` and parse the resulting public URL.

3. **Governance:** Tailscale ACL policy files allow the team to define which users can enable Funnel or Serve, following least-privilege. SOC 2 Type II gives InfoSec a concrete compliance anchor.

4. **Cost:** Free for teams of 6 or fewer. $8/user/month for larger teams.

**Runner-up: SSH reverse tunnels on a self-hosted jump host**

If the corporate security policy prohibits all third-party coordination servers (including Tailscale's), a self-hosted VPS running OpenSSH with `GatewayPorts yes` gives complete data sovereignty. The operational overhead (key management, autossh, TLS via Caddy/nginx, server upkeep) is meaningful but manageable. This approach has zero licensing cost beyond the VPS and requires only outbound port 22, which is almost universally permitted in corporate firewall policies.

Headscale bridges these two options — it removes Tailscale's cloud coordination dependency while keeping the Tailscale client UX — but it does not support Funnel, limiting it to team-internal sharing only.

---

## Risks and Caveats

**Funnel port restrictions are load-bearing for Terminator.** The Fastify server binds to `127.0.0.1` on a user-configured port. Funnel requires the public-facing port to be 443, 8443, or 10000. The server must be reconfigured or a local reverse proxy must sit in front. This is the primary integration risk.

**WebSocket support.** Terminator's remote control uses WebSocket connections. Tailscale Funnel proxies raw TCP, so WebSocket upgrade headers pass through intact. Dev Tunnels supports WSS. SSH reverse tunnels pass raw TCP. All three options support WebSockets — confirm by integration testing the WS ticket handshake.

**Tailscale Funnel is beta.** The documentation notes beta status and non-configurable bandwidth limits. Evaluate whether throughput limits affect terminal I/O latency for production remote-control use.

**Dev Tunnels TLS termination.** Dev Tunnels terminate TLS at the Azure edge and rewrite headers. This may conflict with Terminator's `auth.middleware.ts` if it relies on origin headers for trust decisions. Review before adopting Dev Tunnels.

**SSH tunnel reliability.** Plain `ssh -R` exits when the connection drops. Production use requires `autossh` or a systemd unit with restart logic to replicate the crash-detection behavior in `NgrokManager.setOnCrash()`. The tunnel URL is also fixed (jump host address), unlike ngrok/Tailscale ephemeral URLs.

**Headscale and Funnel incompatibility.** If the team adopts Headscale for data sovereignty, they lose Funnel (public internet exposure). Headscale covers only the internal-sharing use case; external webhook testing would still require a jump host.

**Free plan user limits.** Tailscale's free plan caps at 6 users. Teams larger than 6 must move to the Standard plan ($8/user/month). Confirm headcount before committing.
