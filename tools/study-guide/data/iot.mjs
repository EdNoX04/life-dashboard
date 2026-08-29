// ECE441 — IoT System Design. Minor: Modules 1 (Embedded IoT) & 2 (Automation).
// Module 1 is well covered by 10 decks. Module 2 (ESP8266/NodeMCU, MicroPython,
// WiFi, REST/MQTT code, interrupts, ESP32-vs-ESP8266) is almost entirely ABSENT
// from the decks — added from standard sources and tagged.

import { card, def, edge, trap, ask, ul, ol, p, table, code, kw, st, fn, cm, fig } from '../blocks.mjs';

const svgPipe = `<svg viewBox="0 0 520 90" role="img" aria-label="Sense process act pipeline">
  ${[['Sensor','var(--cyan)',10],['A/D','var(--ink-3)',115],['MCU','var(--green)',210],['D/A','var(--ink-3)',315],['Actuator','var(--pink)',415]].map(([t,c,x],i)=>`
  <rect x="${x}" y="28" width="${t==='MCU'||t==='Sensor'||t==='Actuator'?95:80}" height="34" rx="5" fill="none" stroke="${c}"/>
  <text class="svg-t" x="${x+(t==='MCU'||t==='Sensor'||t==='Actuator'?47:40)}" y="50" text-anchor="middle" fill="${c}">${t}</text>`).join('')}
  ${[105,200,305,410].map(x=>`<line x1="${x}" y1="45" x2="${x+10}" y2="45" stroke="var(--ink-2)" marker-end="url(#p)"/>`).join('')}
  <text class="svg-l" x="260" y="80" text-anchor="middle">physical quantity in → decision → physical action out</text>
  <defs><marker id="p" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="var(--ink-2)"/></marker></defs>
</svg>`;

const svgMqtt = `<svg viewBox="0 0 480 170" role="img" aria-label="MQTT publish subscribe">
  <rect x="15" y="65" width="110" height="40" rx="6" fill="rgba(0,229,255,.12)" stroke="var(--cyan)"/><text class="svg-t" x="70" y="82" text-anchor="middle" fill="var(--cyan)">Sensor</text><text class="svg-l" x="70" y="97" text-anchor="middle">publisher</text>
  <rect x="185" y="60" width="110" height="50" rx="6" fill="rgba(255,210,63,.14)" stroke="var(--yellow)"/><text class="svg-t" x="240" y="80" text-anchor="middle" fill="var(--yellow)">Broker</text><text class="svg-l" x="240" y="96" text-anchor="middle">topic: temp</text>
  <rect x="355" y="20" width="110" height="40" rx="6" fill="rgba(49,214,122,.12)" stroke="var(--green)"/><text class="svg-t" x="410" y="45" text-anchor="middle" fill="var(--green)">Phone</text>
  <rect x="355" y="110" width="110" height="40" rx="6" fill="rgba(49,214,122,.12)" stroke="var(--green)"/><text class="svg-t" x="410" y="135" text-anchor="middle" fill="var(--green)">Dashboard</text>
  <line x1="125" y1="85" x2="185" y2="85" stroke="var(--cyan)" marker-end="url(#m)"/><text class="svg-l" x="155" y="78" text-anchor="middle" fill="var(--cyan)">PUBLISH</text>
  <line x1="295" y1="78" x2="355" y2="45" stroke="var(--green)" marker-end="url(#m)"/><line x1="295" y1="92" x2="355" y2="128" stroke="var(--green)" marker-end="url(#m)"/>
  <text class="svg-l" x="330" y="95" text-anchor="middle">SUBSCRIBE</text>
  <defs><marker id="m" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="var(--ink-2)"/></marker></defs>
</svg>`;

const sections = [
  // ===================== MODULE 1 =====================
  {
    module: 'Module 1 · Embedded IoT', id: 'm1-embedded', title: 'Embedded systems',
    html:
      card({ n: '1.1', title: 'What an embedded system is', tags: ['high-yield'], body:
        def('Embedded system', 'A combination of hardware and software (often with mechanical parts) designed to perform a <b>specific, dedicated function</b>, usually as part of a larger system.') +
        p('<b>Six characteristics:</b> single-purpose · autonomous · real-time constraints (hard e.g. airbag vs soft e.g. video buffer) · reactive & always-on · resource-constrained · tightly coupled to hardware.') +
        fig(svgPipe, 'The universal embedded pipeline. Many actuators are driven straight from a GPIO pin, so the D/A stage is often skipped.') +
        p('<b>Six purposes:</b> data collection · communication · signal processing · monitoring · control · application-specific UI.')
      }) +
      card({ n: '1.2', title: 'Microprocessor vs microcontroller', tags: ['high-yield'], body:
        table(['', 'Microprocessor', 'Microcontroller'], [
          ['Contains', 'CPU only', 'CPU + RAM + ROM + I/O on one chip'],
          ['Needs', 'External RAM/ROM/peripherals', 'Largely self-contained'],
          ['Use', 'General computing (PCs)', 'Dedicated embedded control'],
          ['Example', 'Intel Core, AMD Ryzen', 'ATmega328P, ESP32, STM32'],
        ]) +
        edge('<b>Harvard vs von Neumann</b> <span class="tag t-add">+ added</span> — the decks cover the memory hierarchy but never name these. Harvard = <b>separate</b> instruction and data buses (AVR/ATmega328P — lets it fetch and execute at once); von Neumann = <b>one shared</b> bus (simpler, can bottleneck). Worth a mark under “Memory Architectures”.')
      })
  },
  {
    module: 'Module 1 · Embedded IoT', id: 'm1-levels', title: 'IoT levels & views',
    html:
      card({ n: '1.3', title: 'IoT Levels 1–6 (Bahga & Madisetti)', tags: ['high-yield'], body:
        p('This is what the syllabus means by “IoT level specification”. Each level is defined by <b>how many nodes</b>, and <b>where storage and analysis happen</b>.') +
        table(['Level', 'Nodes', 'Storage / analysis', 'Example'], [
          ['<b>1</b>', 'Single node', 'All local (storage, analysis, app on device)', 'Home temperature monitor'],
          ['<b>2</b>', 'Single node', 'Analysis local, storage + app in cloud', 'Weather monitoring'],
          ['<b>3</b>', 'Single node', 'Storage + analysis both in cloud', 'Wearable health monitor'],
          ['<b>4</b>', 'Multiple nodes', 'Local analysis, cloud storage; observer nodes', 'City traffic sensors'],
          ['<b>5</b>', 'Many end nodes + 1 coordinator', 'Coordinator → cloud; cloud analyses', 'Smart agriculture (WSN)'],
          ['<b>6</b>', 'Multiple independent nodes', 'All cloud; a central controller commands all nodes', 'Smart city'],
        ]) +
        p('The jumps: L1→L2 pushes storage to cloud; L2→L3 pushes analysis to cloud; L3→L4 adds multiple nodes; L4→L5 adds a <b>coordinator/gateway</b>; L5→L6 nodes are independent but a central controller oversees them.') +
        ask('“Explain IoT Levels with examples” is a standard 5–10 mark question. Reproduce this table and name one example per level.')
      }) +
      card({ n: '1.4', title: 'Functional vs operational view', body:
        table(['', 'Functional view', 'Operational view'], [
          ['Answers', 'WHAT the system does', 'HOW & WHERE it’s deployed'],
          ['Shows', 'Sensing, processing, storing functions', 'Protocols per link, hardware, topology'],
          ['Nature', 'Technology-independent', 'Includes infrastructure constraints'],
        ]) +
        p('Design order: purpose & requirements → IoT level → functional view → operational view → device & component integration.')
      })
  },
  {
    module: 'Module 1 · Embedded IoT', id: 'm1-pillars', title: 'Pillars, sensors & actuators',
    html:
      card({ n: '1.5', title: 'The four pillars of embedded IoT', tags: ['high-yield'], body:
        table(['Pillar', 'Job', 'Examples'], [
          ['<b>Sensing</b>', 'Read the physical world', 'DHT11, PIR, LDR, ultrasonic'],
          ['<b>Computation</b>', 'Process data on-device', 'MCU (AVR, ARM, Xtensa)'],
          ['<b>Communication</b>', 'Move data device↔cloud', 'UART, SPI, I2C, Wi-Fi, MQTT'],
          ['<b>Actuation</b>', 'Drive physical change', 'Relay, servo, motor, LED'],
        ]) +
        p('Remove any pillar and it stops being IoT: no actuation → just monitoring; no communication → a Level-1 standalone device; no sensing → nothing to act on.')
      }) +
      card({ n: '1.6', title: 'Sensors — specs & formulas', tags: ['high-yield'], body:
        table(['Sensor', 'Measures', 'Output', 'Key spec'], [
          ['<b>DHT11 / DHT22</b>', 'Temp + humidity', '1-wire digital', 'DHT11 ±2°C, ≤1 sample / 2 s'],
          ['<b>PIR (HC-SR501)</b>', 'Motion / presence', 'Digital HIGH/LOW', '~7 m, 120°, 4.5–12 V'],
          ['<b>Ultrasonic (HC-SR04)</b>', 'Distance', 'Echo pulse width', '2–400 cm, ±3 mm, 40 kHz'],
          ['<b>LDR</b>', 'Light', 'Analog (needs ADC)', 'MΩ dark → few Ω bright'],
        ]) +
        def('HC-SR04 distance formula', 'Trigger HIGH for <b>10 µs</b> → the Echo pin stays HIGH for the round-trip time. <b>Distance = (speed of sound × echo time) / 2</b>, using ≈ 330–343 m/s. The ÷2 is because the pulse travels there <em>and</em> back — forgetting it doubles every reading.') +
        p('<b>LDR voltage divider:</b> LDR + fixed resistor across 5 V; read the junction with the ADC. As light rises, LDR resistance falls, so the tap voltage swings — that’s how you turn “light” into a number.')
      }) +
      card({ n: '1.7', title: 'Actuators & interfaces', body:
        table(['Actuator', 'Control', 'Note'], [
          ['Relay', 'GPIO HIGH/LOW', 'Isolates MCU from mains loads'],
          ['Servo (SG90)', 'PWM 50 Hz', '1 ms pulse = 0°, 2 ms = 180°'],
          ['DC motor + L298N', 'IN1/IN2 dir, ENA PWM speed', 'H-bridge, 2 motors'],
          ['LED / buzzer', 'GPIO (buzzer active vs passive)', 'LED needs series resistor'],
        ]) +
        table(['Bus', 'Wires', 'Note'], [
          ['UART', '2 (TX, RX)', 'Async; baud must match (9600…)'],
          ['SPI', '4 (MOSI/MISO/SCK/CS)', 'Fastest; 1 CS per slave'],
          ['I2C', '2 (SDA, SCL)', 'Up to 127 devices; 4.7 kΩ pull-ups'],
          ['GPIO', '1 per pin', 'Digital HIGH/LOW; PWM-capable pins'],
        ])
      })
  },
  {
    module: 'Module 1 · Embedded IoT', id: 'm1-comm', title: 'Communication models',
    html:
      card({ n: '1.8', title: 'The four models + REST', tags: ['high-yield'], body:
        table(['Model', 'How it works'], [
          ['<b>Request–Response</b>', 'Client asks, server replies (stateless). REST uses this.'],
          ['<b>Publish–Subscribe</b>', 'Publishers → topics on a broker → subscribers. MQTT uses this.'],
          ['<b>Push–Pull</b>', 'Producers push to a queue, consumers pull; queue buffers rate mismatch.'],
          ['<b>Exclusive Pair</b>', 'Persistent, full-duplex connection. WebSocket uses this.'],
        ]) +
        p('<b>REST</b> = stateless HTTP APIs on resources (URIs) using <b>GET / POST / PUT / DELETE</b>, payload in JSON. <b>WebSocket</b> = full-duplex persistent link (HTTP Upgrade → 101 Switching Protocols) so the cloud can push to the device instantly.')
      })
  },

  // ===================== MODULE 2 =====================
  {
    module: 'Module 2 · Automation', id: 'm2-warn', title: 'Read this first',
    html:
      card({ title: 'Most of Module 2 is not in your decks', tags: ['added'], body:
        trap('The 10 decks cover <b>Arduino Uno</b> well, but the syllabus’s Module 2 is mostly <b>ESP8266 NodeMCU, MicroPython, Wi-Fi, REST/MQTT code, interrupts and ESP32-vs-ESP8266</b> — and those are <b>almost entirely absent</b>. Everything tagged <span class="tag t-add">+ added</span> below is filled from standard sources so this half of the paper isn’t blank. Cross-check against any class notes if you can.')
      })
  },
  {
    module: 'Module 2 · Automation', id: 'm2-uno', title: 'Arduino Uno',
    html:
      card({ n: '2.1', title: 'Uno / ATmega328P specs', tags: ['high-yield'], body:
        table(['Spec', 'Value'], [
          ['Microcontroller', 'ATmega328P (8-bit AVR, RISC)'],
          ['Clock', '16 MHz'],
          ['Flash / SRAM / EEPROM', '32 KB / 2 KB / 1 KB'],
          ['Digital I/O', '14 (6 are PWM: 3, 5, 6, 9, 10, 11)'],
          ['Analog in', '6 (A0–A5), 10-bit ADC (1024 levels)'],
          ['Operating / input voltage', '5 V / 7–12 V'],
          ['Pin current', '40 mA per pin'],
        ]) +
        p('ADC resolution: 5 V / 1024 ≈ <b>4.9 mV</b> per step. PWM: <code>analogWrite(pin, 0–255)</code>, output ≈ (duty/255) × 5 V.')
      }) +
      card({ n: '2.2', title: 'Sketch structure', tags: ['high-yield'], body:
        code(
`${cm('// Blink — the canonical sketch')}
${kw('void')} ${fn('setup')}() {              ${cm('// runs once')}
  ${fn('pinMode')}(13, OUTPUT);
}
${kw('void')} ${fn('loop')}() {               ${cm('// runs forever')}
  ${fn('digitalWrite')}(13, HIGH);
  ${fn('delay')}(1000);            ${cm('// ms')}
  ${fn('digitalWrite')}(13, LOW);
  ${fn('delay')}(1000);
}`) +
        p('Core API: <code>pinMode</code>, <code>digitalRead/Write</code>, <code>analogRead/Write</code>, <code>delay</code>, and Serial (<code>Serial.begin(9600)</code>, <code>Serial.println()</code>). Workflow: write sketch → compile → upload over USB → runs standalone.')
      })
  },
  {
    module: 'Module 2 · Automation', id: 'm2-esp', title: 'ESP8266 NodeMCU & ESP32',
    html:
      card({ n: '2.3', title: 'ESP8266-12E NodeMCU', tags: ['added', 'high-yield'], body:
        table(['Spec', 'ESP8266-12E'], [
          ['Chip', 'Tensilica L106 (32-bit)'],
          ['Clock', '80 MHz (up to 160)'],
          ['Flash', '4 MB (typical)'],
          ['GPIO', '~11 usable + 1 ADC'],
          ['ADC', '1 channel, 10-bit (0–1 V, 3.3 V-tolerant via divider on board)'],
          ['Wi-Fi', '802.11 b/g/n, 2.4 GHz'],
          ['Logic level', '3.3 V (NOT 5 V-tolerant)'],
        ]) +
        trap('The NodeMCU is <b>3.3 V logic</b>. Feeding a 5 V sensor output straight into a GPIO can damage it — use a divider or level shifter. This is the classic viva question.')
      }) +
      card({ n: '2.4', title: 'ESP8266 vs ESP32', tags: ['added', 'high-yield'], body:
        table(['', 'ESP8266', 'ESP32'], [
          ['CPU', 'Single-core L106', 'Dual-core Xtensa LX6'],
          ['Clock', '80–160 MHz', '160–240 MHz'],
          ['Wireless', 'Wi-Fi only', 'Wi-Fi + Bluetooth + BLE'],
          ['GPIO', '~11', '~34'],
          ['ADC', '1 ch, 10-bit', '18 ch, 12-bit'],
          ['Touch / DAC', 'No', 'Yes (capacitive touch, 2× DAC)'],
        ]) +
        p('Rule of thumb: ESP8266 for cheap Wi-Fi sensing; ESP32 when you need Bluetooth, more pins, or more compute.')
      })
  },
  {
    module: 'Module 2 · Automation', id: 'm2-micropython', title: 'MicroPython, Wi-Fi & cloud',
    html:
      card({ n: '2.5', title: 'MicroPython & flashing', tags: ['added'], body:
        def('MicroPython', 'A lean implementation of Python 3 for microcontrollers — you write Python instead of C/C++, and run it interactively over a REPL. Edited in the <b>Thonny</b> or uPyCraft IDE.') +
        p('<b>Flashing the ESP8266 (once):</b> erase the chip and write the MicroPython firmware with <code>esptool</code>:') +
        code(
`esptool.py --port COM3 erase_flash
esptool.py --port COM3 write_flash 0 esp8266.bin`) +
        p('After flashing, the board exposes a Python REPL over serial; <code>boot.py</code> and <code>main.py</code> run automatically at power-on.')
      }) +
      card({ n: '2.6', title: 'Connect to Wi-Fi & POST to the cloud', tags: ['added', 'high-yield'], body:
        code(
`${kw('import')} network, urequests
wlan = network.${fn('WLAN')}(network.STA_IF)
wlan.${fn('active')}(True)
wlan.${fn('connect')}(${st("'SSID'")}, ${st("'password'")})
${kw('while')} ${kw('not')} wlan.${fn('isconnected')}(): ${kw('pass')}

${cm('# REST: POST a reading to the cloud')}
urequests.${fn('post')}(${st("'http://api.example.com/data'")},
    json={${st("'temp'")}: 28})`) +
        p('<b>REST verbs:</b> GET = read, POST = create/upload, PUT = update, DELETE = remove; payload is JSON. This is the “Interfacing ESP with the Cloud (REST — GET/POST)” syllabus line.')
      }) +
      card({ n: '2.7', title: 'MQTT', tags: ['added', 'high-yield'], body:
        def('MQTT', 'Message Queue Telemetry Transport — a lightweight <b>publish/subscribe</b> protocol over TCP, ideal for constrained IoT devices. Devices <b>publish</b> to a <b>topic</b> on a <b>broker</b>; other devices <b>subscribe</b> to that topic.') +
        fig(svgMqtt, 'The sensor publishes to a topic; the broker fans it out to every subscriber. Publisher and subscribers never talk directly — they’re decoupled.') +
        table(['QoS', 'Guarantee'], [
          ['<b>0</b> — at most once', '"Fire and forget" — may be lost, never duplicated'],
          ['<b>1</b> — at least once', 'Guaranteed delivery, but may arrive twice'],
          ['<b>2</b> — exactly once', 'Guaranteed once — highest overhead'],
        ]) +
        p('<b>Retained message:</b> the broker keeps the last message on a topic so a new subscriber gets it immediately. <b>MQTT vs REST:</b> MQTT is push-based, persistent, low-overhead (great for many sensors); REST is pull-based request/response. <b>Broker</b> example: Mosquitto; library: <code>umqtt.simple</code> on MicroPython.') +
        ask('The course lab explicitly lists “publish temperature data to an MQTT broker” — expect a question on broker/topic/QoS. The QoS table is the high-value part.')
      })
  },
  {
    module: 'Module 2 · Automation', id: 'm2-interrupts', title: 'Interrupts',
    html:
      card({ n: '2.8', title: 'Interrupts', tags: ['added', 'high-yield'], body:
        def('Interrupt', 'A hardware signal that <b>pauses the main program</b> to run a short <b>ISR (Interrupt Service Routine)</b>, then resumes — so the MCU reacts instantly to an event instead of constantly polling for it.') +
        code(
`${fn('attachInterrupt')}(
  ${fn('digitalPinToInterrupt')}(2),  ${cm('// pin')}
  onMotion,                    ${cm('// ISR')}
  RISING);                     ${cm('// trigger edge')}`) +
        p('<b>Trigger modes:</b> RISING, FALLING, CHANGE, LOW. <b>ISR rules:</b> keep it tiny, no <code>delay()</code> or <code>Serial.print()</code> inside, and mark shared variables <code>volatile</code>. On the Uno only pins <b>2 and 3</b> support external interrupts; the ESP8266 allows interrupts on most GPIOs.') +
        edge('Contrast <b>interrupt vs polling</b>: polling wastes CPU checking a pin in a loop and can miss brief events; an interrupt is event-driven and never misses the edge. That comparison is the most likely exam framing.')
      })
  },
];

export default {
  code: 'ECE441',
  title: 'IoT System Design',
  blurb: 'Retro study guide for the ECE441 minor exam — Modules 1 (Embedded IoT) and 2 (Automation).',
  examTime: '4–5 PM',
  examISO: '2026-09-03T16:00:00+05:30',
  lede: 'Module 1 from your ten decks; Module 2 (ESP8266, MicroPython, Wi-Fi, MQTT, interrupts) is mostly added from standard sources because the decks skip it. <span class="kbd">/</span> to search · <b>Cram</b> shows only definitions, tables and extra-marks boxes.',
  sections,
};
