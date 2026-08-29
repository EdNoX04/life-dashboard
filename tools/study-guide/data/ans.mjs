// CSE337 — Advanced Network Security & IAM. Minor exam: Modules 1–2.
// Content from Dr Shilpi Sharma's three decks (143 slides), the CSE337 minor
// question paper + Feb-2026 re-paper + Sept-2025 mid-sem, and web-sourced
// gap-fills (tagged "added") for the syllabus items the decks skip: IPSec
// AH/ESP + tunnel/transport + IKE, WPA3 Dragonblood, circuit-level firewalls
// and WAFs, and the OSI/TCP-IP layer mapping.

import { card, def, edge, trap, ask, ul, ol, p, table, code, fig } from '../blocks.mjs';

// ---- a couple of SVG diagrams, drawn once ----------------------------------

const svgOSI = `<svg viewBox="0 0 520 300" role="img" aria-label="OSI to TCP/IP layer mapping">
  <text class="svg-t" x="90" y="20" text-anchor="middle">OSI (7 layers)</text>
  <text class="svg-t" x="380" y="20" text-anchor="middle">TCP/IP (4 layers)</text>
  ${['Application','Presentation','Session','Transport','Network','Data Link','Physical']
    .map((n,i)=>`<rect class="svg-b" x="20" y="${30+i*36}" width="140" height="30" rx="4"/><text class="svg-l" x="90" y="${50+i*36}" text-anchor="middle">${7-i}. ${n}</text>`).join('')}
  ${[['Application',0,3,'var(--cyan)'],['Transport',3,1,'var(--green)'],['Internet',4,1,'var(--yellow)'],['Link',5,2,'var(--pink)']]
    .map(([n,start,span,c])=>`<rect x="300" y="${30+start*36}" width="160" height="${span*36-6}" rx="4" fill="none" stroke="${c}" stroke-width="1.5"/><text class="svg-l" x="380" y="${30+start*36+ (span*36-6)/2 +4}" text-anchor="middle" fill="${c}">${n}</text>`).join('')}
  ${[0,3,4,5].map(i=>`<line x1="160" y1="${45+i*36}" x2="300" y2="${45+i*36}" stroke="var(--line-2)" stroke-dasharray="3 3"/>`).join('')}
</svg>`;

const svgIPSec = `<svg viewBox="0 0 520 210" role="img" aria-label="IPSec transport mode vs tunnel mode packet layout">
  <text class="svg-t" x="10" y="18">Transport mode — host-to-host</text>
  <rect class="svg-b" x="10" y="28" width="70" height="30"/><text class="svg-l" x="45" y="47" text-anchor="middle">IP hdr</text>
  <rect x="80" y="28" width="60" height="30" fill="rgba(49,214,122,.15)" stroke="var(--green)"/><text class="svg-l" x="110" y="47" text-anchor="middle" fill="var(--green)">ESP</text>
  <rect class="svg-b" x="140" y="28" width="110" height="30"/><text class="svg-l" x="195" y="47" text-anchor="middle">TCP + data</text>
  <text class="svg-l" x="255" y="47">← payload encrypted, original IP header kept</text>

  <text class="svg-t" x="10" y="98">Tunnel mode — gateway-to-gateway (VPN)</text>
  <rect x="10" y="108" width="80" height="30" fill="rgba(0,229,255,.15)" stroke="var(--cyan)"/><text class="svg-l" x="50" y="127" text-anchor="middle" fill="var(--cyan)">new IP hdr</text>
  <rect x="90" y="108" width="55" height="30" fill="rgba(49,214,122,.15)" stroke="var(--green)"/><text class="svg-l" x="117" y="127" text-anchor="middle" fill="var(--green)">ESP</text>
  <rect class="svg-b" x="145" y="108" width="70" height="30"/><text class="svg-l" x="180" y="127" text-anchor="middle">orig IP</text>
  <rect class="svg-b" x="215" y="108" width="110" height="30"/><text class="svg-l" x="270" y="127" text-anchor="middle">TCP + data</text>
  <text class="svg-l" x="10" y="165">whole original packet (incl. its IP header) is encrypted and wrapped</text>
  <text class="svg-l" x="10" y="182">in a new one — this is why the internal topology stays hidden.</text>
</svg>`;

const svgZTA = `<svg viewBox="0 0 520 260" role="img" aria-label="NIST SP 800-207 Zero Trust logical components">
  <rect x="200" y="15" width="120" height="40" rx="6" fill="rgba(157,123,255,.15)" stroke="var(--purple)"/>
  <text class="svg-t" x="260" y="33" text-anchor="middle" fill="var(--purple)">Policy Engine</text>
  <text class="svg-l" x="260" y="48" text-anchor="middle">(PE) — decides</text>
  <rect x="200" y="80" width="120" height="40" rx="6" fill="rgba(157,123,255,.1)" stroke="var(--purple)"/>
  <text class="svg-t" x="260" y="98" text-anchor="middle" fill="var(--purple)">Policy Admin</text>
  <text class="svg-l" x="260" y="113" text-anchor="middle">(PA) — executes</text>
  <line x1="260" y1="55" x2="260" y2="80" stroke="var(--line-2)"/>
  <text class="svg-l" x="330" y="72">Control Plane</text>
  <line x1="20" y1="140" x2="500" y2="140" stroke="var(--line)" stroke-dasharray="4 4"/>
  <text class="svg-l" x="330" y="155">Data Plane</text>
  <rect x="40" y="175" width="90" height="36" rx="5" fill="rgba(0,229,255,.1)" stroke="var(--cyan)"/><text class="svg-l" x="85" y="197" text-anchor="middle" fill="var(--cyan)">Subject +<tspan x="85" dy="0"> device</tspan></text>
  <rect x="215" y="175" width="90" height="36" rx="5" fill="rgba(49,214,122,.15)" stroke="var(--green)"/><text class="svg-t" x="260" y="197" text-anchor="middle" fill="var(--green)">PEP</text>
  <rect x="390" y="175" width="90" height="36" rx="5" fill="rgba(255,210,63,.1)" stroke="var(--yellow)"/><text class="svg-l" x="435" y="197" text-anchor="middle" fill="var(--yellow)">Resource</text>
  <line x1="130" y1="193" x2="215" y2="193" stroke="var(--cyan)" marker-end="url(#a)"/>
  <line x1="305" y1="193" x2="390" y2="193" stroke="var(--green)" marker-end="url(#a)"/>
  <line x1="260" y1="120" x2="260" y2="175" stroke="var(--purple)" stroke-dasharray="3 3"/>
  <defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="var(--ink-2)"/></marker></defs>
</svg>`;

// ---- sections --------------------------------------------------------------

const sections = [
  // ===================== MODULE 1 =====================
  {
    module: 'Module 1 · VPN & Wireless IoT Security', id: 'm1-fw', title: 'Firewalls',
    html:
      card({ n: '1.1', title: 'What a firewall is', tags: ['high-yield'], body:
        def('Firewall', p('A network security device that <b>monitors and filters</b> incoming and outgoing traffic against a set of pre-established security rules. It sits as a <b>barrier between a trusted network and an untrusted one</b> (e.g. your LAN and the internet).')) +
        table(['Type', 'Layer / how it works', 'Trade-off'], [
          ['<b>Packet-filtering</b> (stateless)', 'Inspects each packet alone by IP, port, protocol (ACLs). Layer 3–4.', 'Cheap, fast; no context, easily fooled'],
          ['<b>Stateful inspection</b>', 'Tracks connection state, allows replies to known sessions. Layer 3–4.', 'Better security, moderate cost'],
          ['<b>Proxy / application</b>', 'Intermediary; inspects content at Layer 7 before forwarding.', 'High security; slow, expensive'],
          ['<b>Next-Gen (NGFW)</b>', 'Adds deep packet inspection, app-awareness, IPS, threat intel, AI/ML.', 'Comprehensive; high cost/complexity'],
          ['<b>Circuit-level gateway</b> <span class="tag t-add">+ added</span>', 'Verifies TCP handshake at Layer 5 (session); does not inspect payload.', 'Low overhead; no content check'],
          ['<b>WAF (Web App Firewall)</b> <span class="tag t-add">+ added</span>', 'Layer-7 filter specifically for HTTP/S — blocks SQLi, XSS, CSRF.', 'Protects web apps; web-only'],
        ]) +
        p('<b>Advantages:</b> prevents unauthorised access, monitors traffic, customisable rules. <b>Limits:</b> cannot detect internal/insider threats, may slow the network, needs regular rule updates.') +
        edge('The decks only list the first four types. Naming the <b>circuit-level gateway</b> and the <b>WAF</b>, and giving the OSI layer each one operates at, is the difference between a full-marks taxonomy answer and a half one.')
      })
  },
  {
    module: 'Module 1 · VPN & Wireless IoT Security', id: 'm1-ids', title: 'IDS & IPS',
    html:
      card({ n: '1.2', title: 'Detection vs prevention', tags: ['high-yield', 'past-paper'], body:
        def('IDS', 'Intrusion <b>Detection</b> System — monitors traffic and <b>alerts</b> an administrator. Passive; it watches, it does not block.') +
        def('IPS', 'Intrusion <b>Prevention</b> System — detects <b>and blocks</b> threats in real time. Inline; often built into an NGFW.') +
        table(['Feature', 'IDS', 'IPS'], [
          ['Action', 'Detects only', 'Detects & prevents'],
          ['Placement', 'Passive (out-of-band)', 'Inline (in the traffic path)'],
          ['Response', 'Raises alerts', 'Blocks / modifies traffic'],
          ['Impact', 'No added latency', 'May add latency'],
        ]) +
        p('<b>Network-based (NIDS/NIPS)</b> watches a whole subnet at a gateway — broad view, low host impact, but <b>can miss encrypted traffic</b>. Tools: Snort, Suricata, Cisco IPS. <b>Host-based (HIDS/HIPS)</b> runs on one machine watching file changes and system calls — <b>catches insider threats and sees inside encryption</b>, but is resource-heavy per host. Tools: OSSEC, Tripwire.') +
        ask('“Differentiate between network-based and host-based IDS/IPS with examples.” (both CSE337 papers) — answer with the placement/visibility/encrypted-traffic trade-off above, one tool each.')
      }) +
      card({ n: '1.3', title: 'Signature vs anomaly detection', tags: ['high-yield', 'past-paper'], body:
        table(['Criteria', 'Signature-based', 'Anomaly-based'], [
          ['Detects', 'Known threats only', 'Known + unknown (zero-day)'],
          ['Accuracy', 'Low false positives', 'Higher false positives'],
          ['Resources', 'Lightweight', 'Computationally heavy (ML)'],
          ['Updates', 'Frequent signature DB updates', 'Initial baseline training only'],
          ['Best for', 'Antivirus, Snort rules', 'Fraud detection, IoT anomalies'],
        ]) +
        p('Signature matching works like antivirus — fast pattern lookup against a threat database, but blind to zero-days and polymorphic malware. Anomaly detection builds an ML baseline of “normal” and flags deviations — catches the unknown at the cost of false alarms.') +
        ask('“Compare signature- and anomaly-based detection… which would you recommend for a modern enterprise?” (Sept-2025 mid-sem). Recommend a <b>hybrid</b>: signature for cheap known-threat coverage, anomaly layered on for zero-days.')
      })
  },
  {
    module: 'Module 1 · VPN & Wireless IoT Security', id: 'm1-vpn', title: 'VPNs & IPSec',
    html:
      card({ n: '1.4', title: 'VPN types & protocols', tags: ['high-yield', 'past-paper'], body:
        def('VPN', 'A Virtual Private Network creates a <b>secure, encrypted tunnel</b> over the public internet between a device and a remote server — protecting data from eavesdropping, hiding the IP, and securing public Wi-Fi.') +
        table(['Type', 'Connects', 'Use case'], [
          ['Remote-access', 'One user → a private network', 'Work from home'],
          ['Site-to-site', 'Whole network → whole network', 'Branch offices'],
          ['Mobile', 'Keeps session alive during handoffs', 'Field staff'],
          ['Cloud', 'Users → cloud resources', 'Hybrid environments'],
        ]) +
        table(['Protocol', 'Security', 'Notes'], [
          ['PPTP', 'Low', 'Obsolete, insecure'],
          ['L2TP/IPSec', 'High', 'L2TP tunnels, IPSec encrypts'],
          ['OpenVPN', 'Very high', 'Open-source, SSL/TLS based'],
          ['IKEv2/IPSec', 'High', 'Fast reconnect — mobile-friendly'],
          ['WireGuard', 'Very high', 'Modern, lightweight, very fast'],
        ])
      }) +
      card({ n: '1.5', title: 'Inside IPSec — the deck skips this, examiners don’t', tags: ['added', 'high-yield'], body:
        fig(svgIPSec, 'ESP wraps and encrypts the payload; in tunnel mode the entire original packet is encapsulated, hiding internal addressing.') +
        p('<b>Two protocols inside IPSec:</b>') +
        ul([
          '<b>AH (Authentication Header)</b> — integrity + authentication only, <b>no encryption</b>. Protocol number <b>51</b>.',
          '<b>ESP (Encapsulating Security Payload)</b> — integrity + authentication <b>and confidentiality (encryption)</b>. Protocol number <b>50</b>. This is the one actually used in VPNs.',
        ]) +
        p('<b>Two modes:</b> <b>Transport</b> mode encrypts only the payload and keeps the original IP header (host-to-host). <b>Tunnel</b> mode encrypts the entire original packet and adds a new header (gateway-to-gateway — this is what a site-to-site VPN uses).') +
        p('<b>IKE (Internet Key Exchange)</b> negotiates the keys over <b>UDP 500</b> (and UDP 4500 for NAT traversal): <b>Phase 1</b> sets up a secure channel between peers (Main or Aggressive mode); <b>Phase 2</b> negotiates the actual IPSec SAs (Security Associations) for the traffic.') +
        edge('“Describe the VPN architecture and the working of IPSec and SSL/TLS” is Q4 on the Feb-2026 paper (10 marks). The deck gives you SSL/TLS and the VPN types but <b>nothing</b> on AH/ESP, tunnel/transport or IKE — this card is where those 4–5 marks live.')
      })
  },
  {
    module: 'Module 1 · VPN & Wireless IoT Security', id: 'm1-wifi', title: 'Wireless security: WEP → WPA3',
    html:
      card({ n: '1.6', title: 'The four generations', tags: ['high-yield', 'past-paper'], body:
        table(['Standard', 'Cipher', 'Key mgmt', 'Integrity'], [
          ['<b>WEP</b>', 'RC4, 24-bit IV', 'None', 'CRC-32 (broken)'],
          ['<b>WPA</b>', 'RC4 + TKIP, 48-bit IV', '4-way handshake', 'Michael (MIC)'],
          ['<b>WPA2</b>', 'AES-CCMP', '4-way handshake', 'CBC-MAC'],
          ['<b>WPA3</b>', 'AES-GCMP-256', 'SAE + ECDH/ECDSA', 'BIP-GMAC-256'],
        ]) +
        p('<b>WEP</b> — RC4 stream cipher with a tiny 24-bit IV; cracked in minutes. <b>WPA</b> — a stopgap that bolted TKIP onto RC4. <b>WPA2</b> (802.11i) — mandates <b>CCMP</b>, an AES mode; still the common baseline. <b>WPA3</b> — replaces the pre-shared-key handshake with <b>SAE (Simultaneous Authentication of Equals, “Dragonfly”)</b>, which resists offline dictionary attacks.') +
        p('<b>Personal vs Enterprise:</b> Personal uses a shared password (PSK/SAE); Enterprise uses <b>802.1X + EAP + a RADIUS server</b> for per-user authentication.')
      }) +
      card({ n: '1.7', title: 'KRACK, and the attack WPA3 still has', tags: ['high-yield'], body:
        def('KRACK (2017)', 'Key Reinstallation Attack. By replaying <b>message 3 of the WPA2 4-way handshake</b>, an attacker forces the client to reinstall an already-used key, resetting the nonce/packet counter and letting them decrypt traffic — <b>without knowing the password</b>. Found by Mathy Vanhoef; motivated WPA3’s SAE handshake.') +
        trap('WPA3 is <b>not</b> flawless. <b>Dragonblood (2019)</b> is a class of side-channel and downgrade attacks against SAE/Dragonfly. <span class="tag t-add">+ added</span> The decks cover KRACK in full but never mention Dragonblood — naming it shows you know WPA3 is an improvement, not a cure.') +
        p('<b>Other wireless attacks (deck catalogue):</b> Rogue AP, client mis-association, honeypot AP, MAC spoofing, ad-hoc/soft-AP association, and jamming (exploits 802.11’s CSMA/CA silence requirement). <b>Countermeasures:</b> WPA2/WPA3-Enterprise with 802.1X, SSID cloaking, disabling remote admin, and a <b>WIPS</b> (Wireless IPS) to detect rogue APs.')
      })
  },
  {
    module: 'Module 1 · VPN & Wireless IoT Security', id: 'm1-stack', title: 'Stacks, OS, web, PKI',
    html:
      card({ n: '1.8', title: 'OSI & TCP/IP — and where security lives', tags: ['past-paper'], body:
        fig(svgOSI, 'The deck lists both stacks as bullets but never maps them. This mapping is the standard exam figure.') +
        p('<b>OSI</b> — 7 layers: Physical, Data Link, Network, Transport, Session, Presentation, Application. Wireless security operates mainly at <b>Layer 2 (Data Link)</b> and <b>Layer 3 (Network)</b>. <b>TCP/IP</b> — 4 layers: Link, Internet, Transport, Application; encryption/authentication happen at Transport and Application.') +
        edge('Draw the side-by-side mapping (added here) even if only asked to “explain the layers” — a labelled diagram earns the diagram marks the bullet list can’t.')
      }) +
      card({ n: '1.9', title: 'PKI, SSL/TLS, HTTPS', body:
        p('<b>PKI</b> uses <b>asymmetric cryptography</b> (public/private key pairs) and <b>digital certificates</b> issued by Certificate Authorities to prove identity — the foundation for SSL/TLS. <b>SSL/TLS</b> secures data in transit using those certificates; <b>TLS 1.3</b> is current. <b>HTTPS = HTTP over TLS.</b> WPA2/WPA3-Enterprise use <b>EAP with certificates</b>, tying wireless auth back to PKI.') +
        p('<b>OS basics:</b> the OS manages hardware/software/network resources; security features = user authentication, access control, host firewall; regular patching closes exploited vulnerabilities. <b>Web basics:</b> client–server model, browser/server/cookies, HTTP vs HTTPS.')
      })
  },

  // ===================== MODULE 2 =====================
  {
    module: 'Module 2 · Zero Trust Architecture', id: 'm2-trad', title: 'Perimeter security → Zero Trust',
    html:
      card({ n: '2.1', title: 'Why the castle-and-moat model fails', tags: ['high-yield'], body:
        def('Perimeter (castle-and-moat) model', 'Traditional security treats the network as a trusted zone behind firewalls/IPS/VPN. Guards check identity <b>once</b> at the gateway; once inside, users are <b>implicitly trusted</b> and move freely.') +
        p('<b>Why it breaks:</b> it ignores insider threats, collapses once the perimeter is breached (free <b>lateral movement</b>), and doesn’t fit cloud, BYOD or remote work where there <b>is no perimeter</b>.') +
        ask('“Identify the security weaknesses in the traditional perimeter-based model” — Q6a on the Feb-2026 re-paper (3 marks). Answer: implicit internal trust, single point of failure at the perimeter, no defence against lateral movement, and no fit for cloud/BYOD.')
      }) +
      card({ n: '2.2', title: '“Never trust, always verify”', tags: ['high-yield'], body:
        def('Zero Trust', 'Never automatically trust anyone or anything, inside or outside the network. <b>Every</b> user, device and application is <b>continuously authenticated and authorised</b> before accessing <b>any</b> resource, with <b>least-privilege</b> access enforced throughout.') +
        p('The cycle: <b>Authenticate → Authorise → Enforce least privilege → Monitor continuously →</b> (repeat every session). Six components: strong identity (MFA/SSO), device compliance, least-privilege access, continuous monitoring/logging, encryption in transit & at rest, and <b>micro-segmentation</b>.') +
        table(['', 'Traditional', 'Zero Trust'], [
          ['Trust model', 'Implicit trust inside', 'Never trust, always verify'],
          ['Boundary', 'Network perimeter', 'Identity & context'],
          ['Access', 'Broad, static', 'Least-privilege, per-session'],
          ['Verification', 'Once, at the gateway', 'Continuous'],
          ['Response', 'Reactive', 'Proactive, automated'],
        ])
      })
  },
  {
    module: 'Module 2 · Zero Trust Architecture', id: 'm2-nist', title: 'NIST SP 800-207',
    html:
      card({ n: '2.3', title: 'The framework & its tenets', tags: ['high-yield', 'past-paper'], body:
        def('NIST SP 800-207 (Aug 2020)', 'The US NIST standard framework for implementing Zero Trust in enterprises and federal agencies.') +
        p('<b>The 7 tenets (know at least five):</b>') +
        ol([
          'All data sources and computing services are <b>resources</b>.',
          'All communication is secured <b>regardless of network location</b>.',
          'Access is granted <b>per session</b>.',
          'Access is determined by <b>dynamic policy</b> (identity, device, location, behaviour).',
          'The enterprise <b>monitors the integrity and security posture</b> of all assets.',
          'Authentication and authorisation are <b>dynamic and strictly enforced</b> before access.',
          'The enterprise <b>collects as much data as possible</b> to improve its security posture.',
        ]) +
        ask('“Discuss the NIST SP 800-207 model — its key principles and components” is Q5 on the Feb-2026 paper (10 marks). Give the 7 tenets + the PE/PA/PEP diagram below.')
      }) +
      card({ n: '2.4', title: 'Logical components — PE, PA, PEP', tags: ['high-yield'], body:
        fig(svgZTA, 'Control plane: the Policy Engine decides, the Policy Administrator executes. Data plane: the PEP is the gatekeeper in front of every resource.') +
        table(['Component', 'Role'], [
          ['<b>Policy Engine (PE)</b>', 'Makes the allow/deny <b>decision</b> using the trust algorithm'],
          ['<b>Policy Administrator (PA)</b>', 'Executes the decision — establishes/tears down the session'],
          ['<b>Policy Enforcement Point (PEP)</b>', 'The gatekeeper in the data path that actually allows or denies access'],
          ['Trust-algorithm inputs', 'Identity, device posture, threat intel, network context, behaviour'],
        ]) +
        edge('The <b>PE + PA</b> together form the “policy decision point” on the control plane; the <b>PEP</b> is on the data plane. Drawing the control-plane / data-plane split (as above) is a distinguishing detail most students miss.')
      })
  },
  {
    module: 'Module 2 · Zero Trust Architecture', id: 'm2-auth', title: 'MFA, SSO & Conditional Access',
    html:
      card({ n: '2.5', title: 'Multi-Factor Authentication', tags: ['high-yield', 'past-paper'], body:
        def('MFA', 'Requires two or more <b>independent</b> credentials from different categories, so compromising one factor is not enough.') +
        table(['Factor', 'Meaning', 'Example'], [
          ['<b>Knowledge</b>', 'Something you know', 'Password, PIN'],
          ['<b>Possession</b>', 'Something you have', 'OTP, smart card, phone'],
          ['<b>Inherence</b>', 'Something you are', 'Fingerprint, Face ID'],
        ]) +
        p('Security rises Knowledge → Possession → Inherence. <b>81% of breaches involve weak or stolen credentials</b> (Verizon DBIR 2024) — the one-line justification for MFA in any answer.') +
        ask('“Explain the something-you-know / have / are principle with examples” is Q1 on the CSE337 minor paper (5 marks). This card is the whole answer.')
      }) +
      card({ n: '2.6', title: 'SSO, Identity Federation & Conditional Access', tags: ['high-yield', 'past-paper'], body:
        def('SSO', 'Single Sign-On — authenticate <b>once</b>, then reach many services without re-logging in. Scope: within one organisation. Uses session tokens.') +
        def('Identity Federation', 'Extends SSO <b>across organisations</b> using <b>SAML, OAuth 2.0, OpenID Connect</b> — e.g. logging into Zoom with your Google account, or a student reaching Coursera with university credentials.') +
        def('Conditional Access Policy (CAP)', 'Dynamic access control based on <b>who / what / where / how</b> — user, app sensitivity, location/IP, device compliance. Outcome per request: Allow, Deny, or step-up to MFA. E.g. login from an unknown device abroad → force MFA or block.') +
        edge('Real anchors to quote: Microsoft says CAP + MFA gives <b>99.9% attack prevention</b>; the 2022 <b>Okta</b> breach exploited SSO; the 2020 <b>Twitter</b> hack came from missing MFA.') +
        ask('“Define and differentiate IdM, Access Management and PAM with an office-building analogy” is Q5 on the CSE337 minor paper — see the IAM card below; it is <b>not</b> in the Zero Trust decks.')
      })
  },
  {
    module: 'Module 2 · Zero Trust Architecture', id: 'm2-seg', title: 'Segmentation, SDP, SDN, NAC',
    html:
      card({ n: '2.7', title: 'Network segmentation & its enablers', tags: ['high-yield'], body:
        def('Network segmentation', 'Dividing a network into isolated segments to limit access and <b>contain breaches / stop lateral movement</b>.') +
        table(['Type', 'How', 'Trade-off'], [
          ['Physical', 'Separate hardware per segment', 'Strong isolation; costly, rigid'],
          ['Logical (VLANs)', 'Logical broadcast domains on shared kit', 'Cheap, flexible; VLAN-hopping risk'],
          ['<b>Micro-segmentation</b>', 'Per-workload / per-app isolation', 'Highest control; complex to manage'],
        ]) +
        table(['Technology', 'What it does'], [
          ['<b>SDP</b> (Software-Defined Perimeter)', 'Identity-centric perimeter around each app; hides resources until user + device verified ("black cloud")'],
          ['<b>SDN</b> (Software-Defined Networking)', 'Separates control plane from data plane; enables dynamic, centrally-managed segmentation'],
          ['<b>NAC</b> (Network Access Control)', 'Authenticates + posture-checks a device, then assigns it to the right segment'],
        ]) +
        ask('“Would you recommend VPN or SDP for BYOD?” (Sept-2025 mid-sem) — recommend <b>SDP</b>: it grants per-app access after verifying device posture, versus a VPN’s broad network-level access. Pair with NAC for posture checks.')
      })
  },

  // ===================== BEYOND THE DECKS (past-paper-driven) =====================
  {
    module: 'Beyond the decks · likely questions', id: 'x-iam', title: 'IAM, PAM & Active Directory',
    html:
      card({ title: 'Why this section exists', tags: ['added'], body:
        trap('The three decks you were given contain <b>almost no Module-3 IAM material</b> — but the CSE337 minor paper’s Q5 (IdM/AM/PAM) and the re-paper’s Q1 (Active Directory OUs, password management) draw straight from it. This section fills that gap from standard sources so those marks aren’t blank.')
      }) +
      card({ n: 'X.1', title: 'IdM vs Access Management vs PAM', tags: ['added', 'past-paper'], body:
        table(['Discipline', 'Question it answers', 'Office-building analogy'], [
          ['<b>Identity Management (IdM)</b>', 'Who are you? (lifecycle: create, update, disable accounts)', 'The HR office that issues and revokes staff ID cards'],
          ['<b>Access Management (AM)</b>', 'What are you allowed into? (authentication + authorisation)', 'The door readers that check your card at each room'],
          ['<b>Privileged Access Management (PAM)</b>', 'Controls the powerful admin/root accounts specifically', 'The master-key cabinet — signed out, time-limited, logged'],
        ]) +
        p('<b>Identity lifecycle:</b> registration & identity proofing → provisioning → periodic access certification → de-provisioning when someone leaves. PAM adds vaulting, session recording and just-in-time elevation for admin accounts.') +
        ask('Q5 (10 marks) literally asks for these three with an office-building analogy — the table above is a full-marks answer.')
      }) +
      card({ n: 'X.2', title: 'Active Directory & OUs', tags: ['added', 'past-paper'], body:
        def('Active Directory (AD)', 'Microsoft’s directory service for Windows domains — a central store of users, computers and resources, providing authentication and authorisation via <b>Domain Controllers (DCs)</b>.') +
        ul([
          '<b>Organizational Unit (OU)</b> — a container to group users/computers for delegated administration and to apply <b>Group Policy Objects (GPOs)</b>.',
          '<b>Domain → Tree → Forest</b> — the structural hierarchy; the forest is the top-level security boundary.',
          '<b>AD vs Azure AD (Entra ID)</b> — on-premises directory vs cloud identity service for modern/hybrid apps.',
          '<b>Password management</b> — GPO-enforced complexity, expiry, lockout and history policies.',
        ]) +
        ask('Q1 of the re-paper: short notes on <b>OUs</b> and <b>password management in IdM</b>. Both are covered here.')
      })
  },
  {
    module: 'Beyond the decks · likely questions', id: 'x-case', title: 'Case studies & the compulsory Q6',
    html:
      card({ n: 'X.3', title: 'BYOD / remote-work scenario (the 10-mark Q6)', tags: ['high-yield', 'past-paper'], body:
        p('Both CSE337 papers make Section C a compulsory 10-mark <b>case study</b> — a university BYOD or a remote-work breach. The marking wants you to <b>name mechanisms and say why</b>, not describe them abstractly. A reusable answer skeleton:') +
        ol([
          '<b>Risks in the current setup:</b> shared WPA2-PSK passwords, one credential per service, no central auth, personal devices → unauthorised access, credential theft, lateral movement.',
          '<b>Fix the Wi-Fi:</b> WPA2-Personal → <b>WPA3</b> / WPA2-Enterprise with 802.1X so each user authenticates individually.',
          '<b>Fix identity:</b> <b>SSO</b> for one secure login across ERP/LMS/email, backed by <b>MFA</b>.',
          '<b>Apply Zero Trust:</b> “never trust, always verify”, <b>Conditional Access</b> (block/step-up by device & location), <b>network segmentation</b> to contain any breach, and <b>SDP</b> instead of a flat VPN.',
        ]) +
        edge('Deck case studies worth one line each: <b>Colonial Pipeline (2021)</b> — one leaked VPN password, no MFA, dormant account → ransomware (MFA is not optional). <b>Google BeyondCorp</b> — no VPN, trust scored per device/user, ~40% fewer breaches (Zero Trust in production). <b>Maersk / NotPetya (2017)</b> — $300M loss → micro-segmentation limits the blast radius.')
      })
  },
];

export default {
  code: 'CSE337',
  title: 'Advanced Network Security & IAM',
  blurb: 'Retro study guide for the CSE337 minor exam — Modules 1 (VPN & Wireless) and 2 (Zero Trust).',
  examLabel: 'Wed 3 Sep, 10–11 AM',
  examISO: '2026-09-03T10:00:00+05:30',
  lede: 'Everything from Dr Sharma’s three decks, plus the IPSec internals, WPA3 weaknesses and IAM material the decks skip but past papers ask for. <span class="kbd">/</span> to search · <b>Cram</b> shows only definitions, tables and extra-marks boxes.',
  sections,
};
