// CSE475 — Blockchain Technologies Platforms & Applications. Minor: Modules 1–2.
// From the architecture deck (14 slides), the Mastering-Ethereum deck (99), the
// modern PoS deck (15), the MultiChain 1-pager and a past exam paper (20CIC08).
// The named platforms in Module 1 (Hyperledger, IBM, Corda, Ripple, BigChainDB,
// IPFS, DApps) are NOT in the decks — added from standard sources and tagged.

import { card, def, edge, trap, ask, ul, ol, p, table, code, kw, st, fn, cm, fig } from '../blocks.mjs';

const svgBlock = `<svg viewBox="0 0 520 150" role="img" aria-label="Blocks linked by hash pointers">
  ${[0,1,2].map(i=>{const x=20+i*170;const c=['var(--ink-3)','var(--cyan)','var(--purple)'][i];return `
  <rect x="${x}" y="30" width="150" height="90" rx="6" class="svg-b" stroke="${c}"/>
  <text class="svg-t" x="${x+75}" y="20" text-anchor="middle" fill="${c}">Block ${i+9}</text>
  <text class="svg-l" x="${x+10}" y="52">prev hash</text>
  <text class="svg-l" x="${x+10}" y="72">nonce · timestamp</text>
  <text class="svg-l" x="${x+10}" y="92">merkle root</text>
  <text class="svg-l" x="${x+10}" y="112">tx1 · tx2 · …</text>`;}).join('')}
  <line x1="190" y1="52" x2="160" y2="52" stroke="var(--pink)" marker-end="url(#h)"/>
  <line x1="360" y1="52" x2="330" y2="52" stroke="var(--pink)" marker-end="url(#h)"/>
  <defs><marker id="h" markerWidth="9" markerHeight="9" refX="1" refY="4" orient="auto"><path d="M9,0 L1,4 L9,8 Z" fill="var(--pink)"/></marker></defs>
</svg>`;

const svgMerkle = `<svg viewBox="0 0 480 200" role="img" aria-label="Merkle tree">
  <rect x="185" y="10" width="110" height="30" rx="4" fill="rgba(255,210,63,.15)" stroke="var(--yellow)"/><text class="svg-t" x="240" y="30" text-anchor="middle" fill="var(--yellow)">Merkle Root</text>
  <rect x="70" y="80" width="110" height="28" rx="4" class="svg-b"/><text class="svg-l" x="125" y="98" text-anchor="middle">H(1+2)</text>
  <rect x="300" y="80" width="110" height="28" rx="4" class="svg-b"/><text class="svg-l" x="355" y="98" text-anchor="middle">H(3+4)</text>
  ${[['Tx1',40],['Tx2',130],['Tx3',270],['Tx4',360]].map(([t,x])=>`<rect x="${x}" y="150" width="70" height="26" rx="4" fill="rgba(0,229,255,.1)" stroke="var(--cyan)"/><text class="svg-l" x="${x+35}" y="167" text-anchor="middle" fill="var(--cyan)">${t}</text>`).join('')}
  <line x1="200" y1="40" x2="125" y2="80" stroke="var(--line-2)"/><line x1="280" y1="40" x2="355" y2="80" stroke="var(--line-2)"/>
  <line x1="105" y1="108" x2="75" y2="150" stroke="var(--line-2)"/><line x1="145" y1="108" x2="165" y2="150" stroke="var(--line-2)"/>
  <line x1="335" y1="108" x2="305" y2="150" stroke="var(--line-2)"/><line x1="375" y1="108" x2="395" y2="150" stroke="var(--line-2)"/>
</svg>`;

const svgAcct = `<svg viewBox="0 0 500 150" role="img" aria-label="EOA and contract account transactions">
  <rect x="20" y="20" width="120" height="44" rx="6" fill="rgba(0,229,255,.12)" stroke="var(--cyan)"/><text class="svg-t" x="80" y="40" text-anchor="middle" fill="var(--cyan)">EOA</text><text class="svg-l" x="80" y="56" text-anchor="middle">has private key</text>
  <rect x="20" y="90" width="120" height="44" rx="6" fill="rgba(157,123,255,.12)" stroke="var(--purple)"/><text class="svg-t" x="80" y="110" text-anchor="middle" fill="var(--purple)">Contract acct</text><text class="svg-l" x="80" y="126" text-anchor="middle">controlled by code</text>
  <rect x="360" y="20" width="120" height="44" rx="6" fill="rgba(0,229,255,.12)" stroke="var(--cyan)"/><text class="svg-t" x="420" y="46" text-anchor="middle" fill="var(--cyan)">EOA</text>
  <rect x="360" y="90" width="120" height="44" rx="6" fill="rgba(157,123,255,.12)" stroke="var(--purple)"/><text class="svg-t" x="420" y="116" text-anchor="middle" fill="var(--purple)">Contract</text>
  <line x1="140" y1="42" x2="360" y2="42" stroke="var(--green)" marker-end="url(#t)"/><text class="svg-l" x="250" y="35" text-anchor="middle" fill="var(--green)">signed tx: value transfer</text>
  <line x1="140" y1="55" x2="360" y2="105" stroke="var(--green)" marker-end="url(#t)"/><text class="svg-l" x="250" y="90" text-anchor="middle" fill="var(--green)">signed tx: code execution</text>
  <line x1="140" y1="112" x2="360" y2="120" stroke="var(--ink-3)" stroke-dasharray="3 3" marker-end="url(#t)"/><text class="svg-l" x="250" y="132" text-anchor="middle">internal (unsigned) message</text>
  <defs><marker id="t" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="var(--ink-2)"/></marker></defs>
</svg>`;

const sections = [
  // ===================== MODULE 1 =====================
  {
    module: 'Module 1 · Introduction to Blockchain Platforms', id: 'm1-what', title: 'What a blockchain is',
    html:
      card({ n: '1.1', title: 'Definition & core properties', tags: ['high-yield'], body:
        def('Blockchain', 'A <b>decentralised, distributed, immutable</b> digital ledger of records (blocks) securely linked by <b>cryptographic hashes</b>.') +
        table(['Property', 'Meaning'], [
          ['<b>Decentralisation</b>', 'No central trusted authority; consensus keeps nodes consistent'],
          ['<b>Persistency / immutability</b>', 'Once in the chain, a block is effectively impossible to alter or roll back'],
          ['<b>Anonymity</b>', 'Users act through addresses, not real identities'],
          ['<b>Auditability</b>', 'Every transaction references earlier ones, so all activity is verifiable'],
        ]) +
        fig(svgBlock, 'Each block stores the hash of the previous block. Change one block and every later hash breaks — this is immutability.') +
        edge('History for a mark or two: David Chaum (1982) proposed the earliest blockchain-like protocol; Haber & Stornetta (1991) built cryptographically chained timestamps; Satoshi Nakamoto (2008) added proof-of-work to solve double-spending.')
      }) +
      card({ n: '1.2', title: 'Anatomy of a block', tags: ['high-yield', 'past-paper'], body:
        p('A block = an <b>80-byte header</b> + a transaction counter + the body of transactions.') +
        table(['Header field', 'Size', 'Purpose'], [
          ['Version', '4 B', 'Which validation rules apply'],
          ['Previous block hash', '32 B', 'The link to the parent — the chain itself'],
          ['Merkle root', '32 B', 'One hash summarising all transactions'],
          ['Timestamp', '4 B', 'Approx. Unix time of mining'],
          ['Difficulty target', '4 B', 'Threshold the block hash must fall under'],
          ['Nonce', '4 B', 'Counter miners vary to find a valid hash'],
        ]) +
        fig(svgMerkle, 'A Merkle tree hashes transactions in pairs up to a single root — so a node can prove a transaction is in a block by checking just a few hashes (SPV), not the whole block.') +
        ask('“Explain the architecture of blockchain with a labelled diagram” and “components of blockchain” are Q6/Q7 on the 20CIC08 paper — the two diagrams above answer both.')
      })
  },
  {
    module: 'Module 1 · Introduction to Blockchain Platforms', id: 'm1-consensus', title: 'Consensus & the trilemma',
    html:
      card({ n: '1.3', title: 'Proof of Work — and Byzantine fault tolerance', tags: ['high-yield', 'past-paper'], body:
        p('<b>PoW loop:</b> a miner builds a candidate block → hashes <code>Prev Hash + Merkle Root + Nonce</code> → checks if hash ≤ difficulty target → if not, change the nonce and repeat (trillions of times) → if yes, broadcast; other nodes verify and append.') +
        def('Byzantine Generals Problem', 'How can distributed parties agree when some may be faulty or malicious? <b>Consensus is the solution</b> — PoW makes cheating economically pointless. <b>PBFT (Practical Byzantine Fault Tolerance)</b> tolerates up to <b>⌊(n−1)/3⌋</b> faulty nodes and is used by permissioned chains like Hyperledger. <span class="tag t-add">+ added</span>') +
        trap('The decks never define the Byzantine Generals Problem or PBFT, but they’re Q6 on the past paper (5 marks). Added here.')
      }) +
      card({ n: '1.4', title: 'The blockchain trilemma', body:
        def('Trilemma', 'A base-layer blockchain can maximise only <b>two of three</b>: <b>Security · Decentralisation · Scalability</b>.') +
        p('Bitcoin optimises security + decentralisation, sacrificing scalability (≈7 TPS). Fixes: <b>Layer 1</b> — PoW→PoS, sharding; <b>Layer 2</b> — rollups, state channels, sidechains.') +
        edge('Energy angle worth a line: pre-Merge Ethereum ≈ 55 TWh/yr; Bitcoin ≈ 135 TWh/yr, ~1777 kWh per transaction versus Visa’s 0.0015 kWh. Ethereum’s move to PoS cut its energy ~99.95%.')
      })
  },
  {
    module: 'Module 1 · Introduction to Blockchain Platforms', id: 'm1-classify', title: 'Classifying platforms',
    html:
      card({ n: '1.5', title: 'Public / private / consortium / hybrid', tags: ['high-yield'], body:
        table(['', 'Public', 'Private', 'Consortium', 'Hybrid'], [
          ['Access', 'Open to all', 'One organisation', 'Selected orgs', 'Mixed'],
          ['Consensus', 'Permissionless', 'Permissioned', 'Federated group', 'Flexible'],
          ['Speed', 'Slow (7–15 TPS)', 'Fast (1000+)', 'Fast', 'Fast (2000+)'],
          ['Example', 'Bitcoin, Ethereum', 'Internal enterprise', 'Supply-chain group', 'Regulated enterprise'],
        ]) +
        p('<b>Permissionless</b> = anyone can join and validate. <b>Permissioned</b> = a controller decides who can read, write and validate.')
      }) +
      card({ n: '1.6', title: 'The named platforms', tags: ['added', 'high-yield', 'past-paper'], body:
        trap('Your decks describe general architecture and Ethereum in depth, but <b>never cover the other named platforms</b> — yet Hyperledger, IBM Blockchain, BigChainDB and IPFS/DApps are all past-paper questions (Q4, Q8, Q9). This table fills that gap.') +
        table(['Platform', 'Type', 'Consensus', 'Language / model', 'Used for'], [
          ['<b>Ethereum</b>', 'Public, permissionless', 'Proof of Stake (post-Merge)', 'Solidity, account model', 'Smart contracts, DApps'],
          ['<b>Hyperledger Fabric</b>', 'Private, permissioned', 'Pluggable (Raft, PBFT-style)', 'Go/Java/Node chaincode', 'Enterprise consortia'],
          ['<b>IBM Blockchain</b>', 'Permissioned (Fabric-based)', 'Fabric ordering service', 'Chaincode', 'Supply chain (Food Trust)'],
          ['<b>R3 Corda</b>', 'Permissioned', 'Notary (no global broadcast)', 'Kotlin/Java (CorDapps)', 'Finance, banking'],
          ['<b>Ripple</b>', 'Permissioned', 'Ripple Protocol (RPCA)', 'XRP ledger', 'Cross-border payments'],
          ['<b>MultiChain</b>', 'Private, permissioned', 'Round-robin mining', 'Bitcoin-derived', 'Multi-asset finance'],
          ['<b>BigChainDB</b>', 'Permissioned DB', 'Tendermint (BFT)', 'MongoDB-backed', 'High-throughput asset DB'],
          ['<b>IPFS</b>', 'P2P storage (not a chain)', 'Content addressing', 'Merkle DAG, CIDs', 'Decentralised file storage'],
        ]) +
        p('<b>DApp (Decentralised Application):</b> a front end + smart-contract back end running on a blockchain instead of a central server. <b>Selection criteria</b> for choosing a platform: permission model, throughput needed, consensus, privacy, smart-contract support, and cost.') +
        edge('<b>MultiChain</b> is the one non-Ethereum platform actually in your material (the 1-pager): a private, permissioned, multi-asset chain by Coin Sciences, built on an enhanced Bitcoin core with admin-controlled permissions and native multi-currency support. Cite it as the worked example of a private blockchain.')
      })
  },

  // ===================== MODULE 2 =====================
  {
    module: 'Module 2 · Ethereum', id: 'm2-basics', title: 'Ethereum basics',
    html:
      card({ n: '2.1', title: 'The world computer', tags: ['high-yield'], body:
        def('Ethereum', 'A global, open-source platform for decentralised applications — a <b>distributed state machine</b> (“world computer”) whose state is a set of accounts and whose transitions are transactions, executed by the <b>Ethereum Virtual Machine (EVM)</b>.') +
        p('Bitcoin is a distributed <b>ledger</b> (mostly currency); Ethereum is a distributed <b>state machine</b> running arbitrary programs. Its contract language is <b>Turing-complete</b> — it supports loops and unbounded computation, unlike Bitcoin’s deliberately limited Script.') +
        trap('<b>Verification challenge:</b> because the language is Turing-complete, you cannot prove in advance that a contract halts (the Halting Problem). Ethereum’s answer is <b>gas metering</b> — every operation costs gas, and execution stops when the gas limit is hit. This is the exam’s favourite “why does Ethereum need gas” point.')
      }) +
      card({ n: '2.2', title: 'Consensus: PoW or PoS?', tags: ['high-yield'], body:
        trap('Your material is <b>mixed</b>. The 99-slide deck teaches Ethereum as <b>Proof of Work</b> (pre-2022 — miners, gasPrice, difficulty bomb). The modern 15-slide deck teaches <b>Proof of Stake</b> (post-Merge — validators, EIP-1559 fees). The <b>real, current answer is Proof of Stake</b> (The Merge, Sept 2022). If a question is rooted in the mining/difficulty narrative, it’s implicitly PoW; if it asks “what does Ethereum use today”, say <b>PoS</b>.') +
        p('<b>PoS:</b> validators stake ETH and are chosen to propose/attest blocks; misbehaviour is “slashed”. Separates an <b>execution client</b> from a <b>consensus client</b>. Cut Ethereum’s energy use by ~99.95%.') +
        table(['', 'Wei', 'Note'], [
          ['wei', '1', 'base atomic unit — all accounting is in wei'],
          ['Gwei (shannon)', '10⁹', 'the unit gas prices are quoted in'],
          ['ether', '10¹⁸', '1 ETH = 10¹⁸ wei (cf. 1 BTC = 10⁸ satoshi)'],
        ])
      })
  },
  {
    module: 'Module 2 · Ethereum', id: 'm2-accounts', title: 'Accounts, keys & wallets',
    html:
      card({ n: '2.3', title: 'EOA vs contract account', tags: ['high-yield'], body:
        table(['', 'Externally Owned Account (EOA)', 'Contract Account'], [
          ['Controlled by', 'A private key', 'Its own code'],
          ['Can initiate a tx?', 'Yes (signs transactions)', 'No — only reacts to being called'],
          ['Has code?', 'No', 'Yes'],
        ]) +
        fig(svgAcct, 'Only an EOA can start a transaction. Contract-to-contract or contract-to-EOA calls are internal “messages”, not independently signed.') +
        p('An address is <b>20 bytes</b>, derived from the public key, which is derived from the private key. Ethereum uses the <b>account/balance model with a per-account nonce</b> — contrast Bitcoin’s <b>UTXO</b> model. The nonce (count of txs sent) prevents replay.')
      }) +
      card({ n: '2.4', title: 'Wallets & keys', body:
        p('A wallet is a <b>keychain</b>, not a store of ether — the ether lives on-chain; the wallet holds the keys that control it.') +
        ul([
          '<b>Non-deterministic (JBOK)</b> — “just a bunch of keys”, each random and unrelated. Hard to back up; discouraged.',
          '<b>Deterministic (HD) wallet</b> — all keys derived from one seed in a tree (<b>BIP-32</b>). One backup recovers everything.',
          '<b>Mnemonic seed (BIP-39)</b> — the seed encoded as 12/24 words (MetaMask). The only way to restore the wallet; keep it offline.',
        ]) +
        p('<b>Mist</b> = the historical official full-node GUI wallet. <b>MetaMask</b> = the lightweight browser-extension wallet talking to a node over JSON-RPC.')
      })
  },
  {
    module: 'Module 2 · Ethereum', id: 'm2-tx', title: 'Transactions, gas & the EVM',
    html:
      card({ n: '2.5', title: 'Transaction structure', tags: ['high-yield', 'past-paper'], body:
        def('Transaction', 'A <b>signed message from an EOA</b>, transmitted by the network and recorded on-chain. It is the <b>only</b> thing that changes state or triggers contract code — contracts never run on their own.') +
        table(['Field', 'Meaning'], [
          ['Nonce', 'Count of txs from this account (prevents replay)'],
          ['Gas price', 'Wei the sender pays per unit of gas'],
          ['Gas limit', 'Max gas the sender will buy for this tx'],
          ['Recipient (to)', '20-byte destination address (EOA or contract)'],
          ['Value', 'Ether to send'],
          ['Data', 'Payload — contract call / creation bytecode'],
          ['v, r, s', 'The ECDSA signature components (no explicit “from” — it’s recovered from these)'],
        ]) +
        p('Serialised with <b>RLP (Recursive Length Prefix)</b> encoding. The four value/data combinations: value only = <b>payment</b>; data only = <b>invocation</b>; both = payment + invocation; neither = empty tx.')
      }) +
      card({ n: '2.6', title: 'Gas', tags: ['high-yield'], body:
        def('Gas', 'The fuel of Ethereum — a <b>separate unit from ether</b> that meters computation. Every EVM opcode costs gas; you pay <code>gas used × gas price</code> in ether.') +
        p('<b>Gas limit</b> caps the work a tx can do, so an infinite loop drains only the limit, not your whole balance. Unused gas is refunded. Higher gas price → faster confirmation. Post-<b>EIP-1559</b> the fee splits into <code>maxFeePerGas</code> and <code>maxPriorityFeePerGas</code> (a base fee is burned + a tip to the validator).') +
        edge('Tie gas back to Turing-completeness (card 2.1): gas is the <b>economic substitute for formal verification</b> — you can’t prove a contract halts, so you meter and bound it at runtime instead. Making that link is a distinction-level point.')
      }) +
      card({ n: '2.7', title: 'The EVM & Solidity', tags: ['past-paper'], body:
        p('The <b>EVM</b> is a stack-based, Turing-complete virtual machine that every node runs identically; Solidity compiles to <b>EVM bytecode</b>. It’s Q10a on the past paper (“EVM with labelled diagram”) — sketch: transaction → EVM (stack + memory + storage, reads world state) → updated state.') +
        code(
`${kw('pragma')} solidity ^0.8.0;

${kw('contract')} ${fn('SimpleStorage')} {
    ${kw('uint256')} storedData;

    ${kw('function')} ${fn('set')}(${kw('uint256')} x) ${kw('public')} {
        storedData = x;
    }
    ${kw('function')} ${fn('get')}() ${kw('public')} view ${kw('returns')} (${kw('uint256')}) {
        ${kw('return')} storedData;
    }
}`) +
        p('<b>Web3.js</b> is the JS library that talks to a node over <b>JSON-RPC</b> (<code>eth_sendTransaction</code>, <code>eth_getBalance</code>) — the front-end path. A Java app uses Web3j and explicit RPC calls instead (Q10b: Java-RPC vs JavaScript native).') +
        edge('<b>ERC-20</b> is the fungible-token standard (functions <code>transfer</code>, <code>approve</code>, <code>balanceOf</code>). Naming it, plus <b>ERC-721</b> for NFTs, adds easy marks to any “tokens / standards” question.')
      })
  },
  {
    module: 'Module 2 · Ethereum', id: 'm2-testnets', title: 'Clients, testnets & worked examples',
    html:
      card({ n: '2.8', title: 'Clients & testnets', body:
        p('<b>Geth</b> (“Go Ethereum”) is the reference client. Historic testnets and their consensus: <b>Ropsten</b> = PoW; <b>Kovan</b> and <b>Rinkeby</b> = Proof of Authority (ether requested, not mined). Test ether comes from faucets and has no value.') +
        p('<b>Testnet vs local chain:</b> a testnet is a live public chain with other users (realistic, slower to sync); a local chain (e.g. Ganache) is instant and private but behaves nothing like the real network.')
      }) +
      card({ n: '2.9', title: 'Worked example — Faucet.sol', tags: ['high-yield'], body:
        p('The deck’s canonical state-transition example, worth reproducing to show you understand value vs invocation:') +
        table(['Tx from EOA (bal 40) to Faucet (bal 20)', 'What runs', 'Result'], [
          ['Send 20 ETH, no data', 'fallback function', 'EOA 20, Faucet 40'],
          ['Data: withdraw(1)', 'withdraw() pays out 1', 'EOA 41, Faucet 19'],
          ['Data: withdraw(2) — too much', 'withdraw() reverts', 'State unchanged (failed)'],
        ]) +
        ask('Past-paper essays to prep: <b>Hyperledger Fabric transaction flow</b> (Q12), <b>blockchain in Healthcare / Supply Chain / Digital Identity</b> (Q14, Q15). Structure each as: problem with the centralised system → what the blockchain adds (immutability, shared ledger, no middleman) → one concrete example.')
      })
  },

  {
    module: 'Beyond the decks · exam scope', id: 'x-gaps', title: 'What’s missing & how the paper is set',
    html:
      card({ title: 'Gaps to be aware of', tags: ['added'], body:
        p('The 20CIC08 past paper (a real prior exam) shows the examiners lean on platforms and theory <b>not</b> in your slides — flagged so you fill them, not discover them cold:') +
        ul([
          '<b>Hyperledger Fabric</b> transaction flow, membership/identity, Composer — covered only in the added table (1.6). Read a Fabric flow diagram before the exam.',
          '<b>IBM Blockchain, BigChainDB, IPFS, DApps</b> — one-liners in table 1.6; expand IPFS (content-addressed storage, CIDs) and DApps (contract back end) if you have time.',
          '<b>Byzantine Generals / PBFT</b> — card 1.3.',
          '<b>EVM internal diagram</b> — sketch from card 2.7; the decks name the EVM but never diagram it.',
        ]) +
        edge('If asked “what consensus does Ethereum use”, the correct 2026 answer is <b>Proof of Stake</b> — do not default to the PoW narrative the big deck teaches. That single fact is the most likely trap in the paper.')
      })
  },
];

export default {
  code: 'CSE475',
  title: 'Blockchain Technologies',
  blurb: 'Retro study guide for the CSE475 minor exam — Modules 1 (platforms) and 2 (Ethereum).',
  examLabel: 'Tue 2 Sep, 4–5 PM',
  examISO: '2026-09-02T16:00:00+05:30',
  lede: 'From all five source files, plus the platforms (Hyperledger, IBM, Corda, BigChainDB, IPFS) and PBFT that past papers ask for but your decks skip. <span class="kbd">/</span> to search · <b>Cram</b> shows only definitions, tables and extra-marks boxes.',
  sections,
};
