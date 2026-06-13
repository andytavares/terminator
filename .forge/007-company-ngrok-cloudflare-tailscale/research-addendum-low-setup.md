## Zero/Low-Setup Tunnel Options — Addendum

### Problem Statement

This addendum evaluates five additional options — bore, localtunnel, zrok, frp, and PageKite — specifically under the constraint that the user is in a corporate environment where ngrok and Cloudflare are blocked, and wants **minimum setup**: ideally a single command with no account required. The critical technical requirement is reliable WebSocket support, because Terminator's remote-control server streams terminal output over a persistent WebSocket connection.

---

## Zero/Low-Setup Tunnel Options

| Option          | Setup steps                                     | Self-hosted?                  | Corp-friendly                                                  | WS support                                        | Status                                    |
| --------------- | ----------------------------------------------- | ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------- |
| **bore**        | 1 cmd (binary or brew)                          | Optional (bore.pub available) | Unknown — routes through bore.pub (single Rust server, no CDN) | Yes (raw TCP — WS is TCP)                         | Active — v0.6.0 Jun 2025, 11.2k stars     |
| **localtunnel** | `npx localtunnel --port N`                      | Optional (lt.me provided)     | Poor — lt.me commonly blocked                                  | **Broken** — multiple open issues (WS 400 errors) | Low activity — last real commit Aug 2022  |
| **zrok**        | Download binary + email invite + enable + share | Optional (zrok.io provided)   | Moderate-High — outbound-only mTLS; OpenZiti zero-trust        | Likely (HTTP proxy mode passes upgrades)          | Active — v2.0.4 May 2026, 89 releases     |
| **frp**         | Requires own VPS running frps + config          | Fully self-hosted (required)  | High — you control server and domain                           | Likely (HTTP proxy covers upgrades)               | Very active — v0.69.1 Jun 2026, 93k stars |
| **PageKite**    | python3 pagekite.py + account                   | Optional (pagekite.me)        | Unknown                                                        | Not documented                                    | **Unmaintained** — last release Apr 2020  |

---

## Detailed Notes Per Option

### bore

Source: https://github.com/ekzhang/bore/blob/main/README.md
Quote: "bore is a modern, simple TCP tunnel in Rust that exposes local ports to a remote server, bypassing standard NAT connection firewalls."

**Install:** Single binary via `brew install bore-cli` or download from the releases page. No account, no signup.

**Usage:**

```
bore local 7681 --to bore.pub
```

**WebSocket:** bore is a raw TCP tunnel — it does not inspect protocols. WebSocket connections (which start as HTTP and upgrade) pass through transparently. No open issues about WebSocket failures.

**Risks:** `bore.pub` is a community-run instance by the author with no SLA, no ToS, and no documented rate limits. For production use, run your own `bore server` on a VPS (same binary, server mode).

**Corporate firewalls:** bore uses TCP port 7835 (non-standard control port). Restrictive firewalls may block it. Workaround: run a self-hosted bore server on port 443.

---

### localtunnel

Source: https://github.com/localtunnel/localtunnel/blob/master/README.md
Quote: "localtunnel exposes your localhost to the world for easy testing and sharing! No need to mess with DNS or deploy just to have others test out your changes."

**Install:** `npx localtunnel --port 7681` — genuinely zero-config, no account.

**WebSocket:** ❌ Hard blocker. Multiple open GitHub issues (369, 390, 468) report WebSocket 400 errors specifically. Issue 468: "ngrok works fine for this WebSocket port" while localtunnel fails. No maintainer response.

**Maintenance:** Last substantive code commit was August 2022. 149 open issues, 18 open PRs with no merge activity. Effectively unmaintained.

**Corporate policy:** `localtunnel.me` is commonly flagged by corporate web proxies as a tunneling tool — in environments where ngrok is blocked, localtunnel is likely blocked too.

**Verdict: Do not use.** WebSocket reliability is broken and the project is unmaintained.

---

### zrok

Source: https://github.com/openziti/zrok/blob/main/README.md
Quote: "zrok is an open source solution for frictionless, secure sharing... built on top of OpenZiti, a free open source project focused on bringing zero trust to any application."

**Install:** 4 steps:

1. Download binary from docs.zrok.io
2. `zrok invite` (email required)
3. `zrok enable <token>`
4. `zrok share public http://localhost:7681`

**WebSocket:** zrok's HTTP proxy mode passes all HTTP traffic including `Upgrade: websocket`. OpenZiti operates at the network layer, so protocol upgrades pass through. No open issues about WebSocket failures found.

**Corporate policy:** OpenZiti uses outbound-only mutual-TLS connections to its controller and routers (standard HTTPS port 443). No inbound firewall rules required. More corporate-friendly than bore's non-standard port. The `zrok.io` domain could still be blocked — the fully self-hosted option (deploy your own OpenZiti network) removes that dependency entirely.

**Maintenance:** v2.0.4 released May 2026. 89 releases. Backed by NetFoundry (commercial entity). Actively maintained.

---

### frp (Fast Reverse Proxy)

Source: https://github.com/fatedier/frp
Quote: "frp is a fast reverse proxy that allows you to expose a local server located behind a NAT or firewall to the Internet. It currently supports TCP and UDP, as well as HTTP and HTTPS protocols."

**Self-hosted requirement:** frp requires you to operate your own VPS running `frps`. No managed relay exists. This disqualifies it from "minimum setup" unless you already have a VPS.

**WebSocket:** HTTP proxy mode in frp passes through `Connection: Upgrade` and `Upgrade: websocket` headers at the TCP layer. No explicit documentation, but the architecture makes it inherent.

**Corporate policy:** Strongest of all options — you control the server, domain, and port. Running on port 443 makes tunnel traffic indistinguishable from HTTPS. No third-party cloud dependency.

**Setup:** For users who already have a VPS: download frps binary, write a 5-line TOML config, run. Then download frpc, write config, run. Not "install in 30 seconds."

**Maintenance:** v0.69.1 released June 1, 2026. Extremely active. 93k+ stars.

---

### PageKite

Source: https://pagekite.net (home page); https://github.com/pagekite/PyPagekite

**Maintenance:** Last release v1.5.1 was April 25, 2020 — over 5 years ago. 750 GitHub stars. Effectively unmaintained. No security patches.

**WebSocket:** Not documented. Unknown.

**Verdict: Do not use.** Unmaintained codebase.

---

## Updated Recommendation Given Minimum-Setup Constraint

Ranked by (setup friction) × (WebSocket reliability) × (corporate-friendliness):

### Tier 1 — bore (truly zero-config, WS reliable)

bore is the best fit for single-command, no-account tunnel access. Because bore is a raw TCP tunnel, it passes WebSocket connections through without any protocol inspection — no 400 errors, no header mangling. Install is one binary.

```bash
brew install bore-cli
bore local 7681 --to bore.pub
```

**Primary risk:** `bore.pub` is a community server with no SLA. For anything beyond casual testing, run a self-hosted bore server:

```bash
bore server --min-port 7681 --max-port 7681   # on your VPS
bore local 7681 --to your-vps-ip              # on your machine
```

Running the server on port 443 (`--to your-vps-ip --port 443`) bypasses most corporate firewall restrictions on non-standard ports.

### Tier 2 — zrok (email signup required, best architecture)

If you can tolerate an email signup, zrok is the most architecturally sound option. OpenZiti's outbound-only mTLS is the most corporate-firewall-friendly approach here — it requires no inbound rules and works through most enterprise proxies.

```bash
# One-time setup:
zrok invite      # enter email, click link
zrok enable <token>

# Each session:
zrok share public http://localhost:7681
```

### Tier 3 — frp (you have a VPS, strictest corp environments)

If `bore.pub` and `zrok.io` are blocked by corporate policy, frp on a self-hosted VPS is the correct answer. Your server, your port, no third-party cloud.

### Do not use:

- **localtunnel** — WebSocket is broken (multiple unresolved issues), project unmaintained
- **PageKite** — unmaintained since 2020
