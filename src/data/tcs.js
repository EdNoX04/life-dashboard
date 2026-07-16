// TCS NQT 2026 prep pack — pattern, packages, 4-day plan, formula sheets, a graded
// question bank (PYQs from Amity handouts + web PYQs + expected), and coding problems.
// Answers verified. `ans` is the 0-based index into `opts`.

export const EXAM = {
  totalQ: 83, totalMin: 190,
  sections: [
    { key: 'num', name: 'Numerical Ability', part: 'Foundation', q: 20, min: 25, diff: 'Medium' },
    { key: 'ver', name: 'Verbal Ability', part: 'Foundation', q: 25, min: 25, diff: 'Easy–Med' },
    { key: 'rea', name: 'Reasoning Ability', part: 'Foundation', q: 20, min: 25, diff: 'Medium' },
    { key: 'aq', name: 'Advanced Quant', part: 'Advanced', q: 15, min: 25, diff: 'Hard' },
    { key: 'ar', name: 'Advanced Reasoning', part: 'Advanced', q: 15, min: 25, diff: 'Hard' },
    { key: 'cod', name: 'Advanced Coding', part: 'Advanced', q: 3, min: 90, diff: 'Hard' },
  ],
  notes: 'No negative marking. Foundation + Advanced both mandatory. Performance decides Ninja / Digital / Prime.',
};

export const PACKAGES = [
  { band: 'Ninja', ctc: '₹3.36–4.5 LPA', pct: '50th–62nd %ile', coding: 'Optional', color: 'var(--cyan)' },
  { band: 'Digital', ctc: '₹7.0–7.5 LPA', pct: '63rd–82nd %ile', coding: 'Solve ≥1 of the advanced problems', color: 'var(--yellow)' },
  { band: 'Prime', ctc: '₹11.5–12.5 LPA', pct: '83rd+ %ile', coding: 'High score on BOTH problems + 80%+ reasoning/verbal', color: 'var(--pink)' },
];

// today = Thu; exam = Mon. Four sprints.
export const PLAN = [
  { day: 'Day 1 · Thu', focus: 'Numerical core + Coding-Decoding', tasks: ['Diagnostic quiz (all sections, spot weak areas)', 'Numerical: Time-Speed-Distance, %, Profit/Loss, Ratio, Averages', 'Reasoning: Coding-Decoding drills', 'Memorize the numerical formula sheet'] },
  { day: 'Day 2 · Fri', focus: 'Reasoning + Verbal', tasks: ['Syllogism, Blood Relations, Series, Direction, Data Sufficiency, Seating', 'Verbal: error spotting, sentence completion, prepositions, synonyms/antonyms', '1 Reading Comprehension passage timed'] },
  { day: 'Day 3 · Sat', focus: 'Advanced + Coding', tasks: ['Advanced Quant (P&C, Probability, SI/CI, Progressions, Logs)', 'Advanced Reasoning (puzzles, cubes, arrangements)', 'CODING: 3 problems on the DSA Arena — arrays, strings, Kadane', 'Revisit every question you got wrong'] },
  { day: 'Day 4 · Sun', focus: 'Mock + revise + rest', tasks: ['One full timed mock (all sections back-to-back)', 'Flash the formula & cheat sheets', 'Light coding — 2 easy problems for confidence', 'Sleep early. Keep ID + hall ticket ready.'] },
];

export const STRATEGY = [
  'No negative marking → attempt EVERY question. Never leave blanks.',
  'Foundation is speed: ~1 min/question. If stuck >75s, mark a guess and move on.',
  'The band is decided by percentile + coding. To push past Ninja → Digital/Prime, the Advanced Coding is the single biggest lever. Solve at least 1 fully; aim for 2.',
  'Coding is auto-graded on hidden test cases — handle edge cases (empty input, negatives, single element) and print EXACTLY the required format.',
  'Reasoning + Verbal 80%+ is the gate for Prime — these are the most scoreable, so bank them.',
];

export const FORMULAS = {
  num: [
    'Avg speed (whole trip) = Total distance ÷ Total time (NOT the mean of speeds)',
    'Two equal legs at a, b → avg = 2ab/(a+b)',
    'Speed: km/h → m/s ×(5/18); m/s → km/h ×(18/5)',
    'Train crossing pole: t = L/speed. Crossing platform: t = (L+P)/speed',
    'Opposite dirs relative speed = a+b; same dir = a−b',
    'x% more than y → y is (x/(100+x))×100 % less than x',
    'Profit% = (SP−CP)/CP ×100; SP = CP(1+p/100); two items ±x% each → net x²/100 % LOSS',
    'Successive % change a then b → net = a+b+ab/100',
    'a:b & b:c → a:b:c = a·b : b·b : b·c (make b common)',
    'HCF×LCM = product of the two numbers',
  ],
  rea: [
    'Coding-Decoding: check letter shift (+/−n), reversal, positional value (A=1…Z=26), or symbol mapping',
    'Unit-digit cycles: 2→(2,4,8,6), 3→(3,9,7,1), 7→(7,9,3,1), 8→(8,4,2,6); use power mod 4',
    'Syllogism: draw Venn; "Some" = overlap, "All A are B" = A inside B, "No" = disjoint; check Either-Or when two negatives',
    'Blood relations: build a small family tree; "only son of my grandfather" = father',
    'Direction: sketch N-E-S-W; net displacement via right triangle',
    'Data Sufficiency: test each statement ALONE first, then together',
  ],
  ver: [
    'Subject-verb agreement: "One of the …" → singular verb; "Neither/Either … " → singular',
    'senior/junior/prior/superior → followed by TO (not than)',
    'too … to (excess); so … that (result); enough placed AFTER adjective',
    'Prepositions: good AT, afraid OF, married TO, capable OF, depend ON',
    'In error-spotting scan for: tense, agreement, preposition, article, redundancy',
    'RC: read question first, then scan for keywords — don\'t over-read',
  ],
};

// ---- MCQ bank ----
const Q = (sec, topic, q, opts, ans, sol, tag = 'expected') => ({ sec, topic, q, opts, ans, sol, tag });
export const QUESTIONS = [
  // ---------- NUMERICAL ----------
  Q('num', 'Time-Speed-Distance', 'A man travels 50 km at 25 km/h, 40 km at 20 km/h and 90 km at 15 km/h. His average speed (km/h) is:', ['25', '20', '18', '40'], 2, 'Total dist 180 km; time = 50/25+40/20+90/15 = 2+2+6 = 10 h. Avg = 180/10 = 18.', 'PYQ'),
  Q('num', 'Time-Speed-Distance', 'A 110 m train passes a pole in 3 s. Time to cross a 165 m platform:', ['3 s', '4 s', '5 s', '7.5 s'], 3, 'Speed = 110/3 m/s. Time = (110+165)/(110/3) = 275·3/110 = 7.5 s.', 'PYQ'),
  Q('num', 'Time-Speed-Distance', 'A 700 m train at 72 km/h crosses a tunnel in 1 min. Tunnel length (m):', ['700', '600', '550', '500'], 3, '72 km/h = 20 m/s. Distance in 60 s = 1200 m. Tunnel = 1200−700 = 500.', 'PYQ'),
  Q('num', 'Time-Speed-Distance', 'Two 125 m trains run opposite; one at 65 km/h, they cross in 6 s. Speed of the other:', ['75 km/h', '85 km/h', '95 km/h', '105 km/h'], 1, 'Relative = (125+125)/6 = 41.67 m/s = 150 km/h. Other = 150−65 = 85.', 'PYQ'),
  Q('num', 'Time-Speed-Distance', 'At 3/5 of his usual speed a man is 2½ h late. His usual time is:', ['4½ h', '3¾ h', '3¼ h', '4¼ h'], 1, 'Time ∝ 1/speed → new time = 5/3 usual. (5/3−1)T = 2.5 → (2/3)T = 2.5 → T = 3.75 h = 3¾ h.', 'PYQ'),
  Q('num', 'Percentages', 'If A\'s salary is 20% more than B\'s, by what % is B\'s less than A\'s?', ['16⅔%', '20%', '25%', '18%'], 0, 'B less by 20/(120)×100 = 16⅔%.', 'PYQ'),
  Q('num', 'Percentages', 'A number is increased by 25% then decreased by 20%. Net change:', ['No change', '5% up', '5% down', '10% up'], 0, 'Net = 25 + (−20) + (25·−20)/100 = 5 − 5 = 0%.'),
  Q('num', 'Percentages', '60% of a number is 45. The number is:', ['60', '75', '80', '90'], 1, 'Number = 45/0.6 = 75.'),
  Q('num', 'Profit & Loss', 'Two articles sold at ₹1200 each — one at 20% profit, the other at 20% loss. Overall:', ['4% profit', '4% loss', 'No profit/loss', '2% loss'], 1, 'Equal SP ±x% each → net loss = x²/100 = 400/100 = 4% loss.', 'PYQ'),
  Q('num', 'Profit & Loss', 'Selling price for 20% profit is ₹600. Cost price:', ['₹480', '₹500', '₹520', '₹540'], 1, 'CP = 600/1.2 = 500.'),
  Q('num', 'Averages', 'Average of 5 numbers is 27. Removing one, the average becomes 25. The removed number is:', ['30', '35', '40', '25'], 1, 'Sum = 135; remaining sum = 100; removed = 35.'),
  Q('num', 'Ratio & Ages', 'A:B = 2:3 and B:C = 4:5. Then A:B:C =', ['8:12:15', '2:3:5', '8:12:10', '6:9:15'], 0, 'Make B common: A:B=8:12, B:C=12:15 → 8:12:15.'),
  Q('num', 'Number System', 'The unit digit of 7⁷¹ is:', ['7', '9', '3', '1'], 2, '7 cycles 7,9,3,1 (len 4). 71 mod 4 = 3 → third = 3.'),
  Q('num', 'Number System', 'HCF × LCM of two numbers = 2028 and HCF = 13. If one number is 26, the other is:', ['78', '104', '52', '156'], 0, 'Product = 2028; other = 2028/26 = 78.'),
  Q('num', 'Simplification', '25% of 200 + 10% of 50 = ?', ['50', '55', '60', '45'], 1, '50 + 5 = 55.'),
  // ---------- REASONING ----------
  Q('rea', 'Coding-Decoding', 'In a code BASIC = DDULE. Then LEADER =', ['NGCFGT', 'NHCGGU', 'OGDFHT', 'OHDGHU'], 1, 'Shifts alternate +2,+3: L+2=N, E+3=H, A+2=C, D+3=G, E+2=G, R+3=U → NHCGGU.', 'PYQ'),
  Q('rea', 'Coding-Decoding', "DELHI = 73541 and CALCUTTA = 82589662. Then CALICUT =", ['5978213', '5279431', '8251896', '8543691'], 2, 'C=8,A=2,L=5,I=1,C=8,U=9,T=6 → 8251896.', 'PYQ'),
  Q('rea', 'Coding-Decoding', 'If MONKEY = XDJMNL (reverse, then −1 each), then TIGER =', ['QDFHS', 'QDFIS', 'QDGHS', 'RDFHS'], 0, 'Reverse TIGER = REGIT; each −1 → QDFHS.'),
  Q('rea', 'Syllogism', 'All bulbs are tables. Some bulbs are pots. Which follows? I. All pots are tables II. No pot is table III. Some pots are tables', ['Only I', 'Only II', 'Only III', 'All follow'], 2, 'Some bulbs (which are tables) are pots → some pots are tables. Only III.', 'PYQ'),
  Q('rea', 'Syllogism', 'All cats are dogs. All dogs are animals. Which follows? I. All cats are animals II. Some animals are cats', ['Only I', 'Only II', 'Both I and II', 'Neither'], 2, 'Cats⊆dogs⊆animals → all cats are animals (I). Converse gives some animals are cats (II). Both.'),
  Q('rea', 'Blood Relations', 'Pointing to a photo a man says, "She is the daughter of my grandfather\'s only son." She is his:', ['Sister', 'Mother', 'Aunt', 'Cousin'], 0, "Grandfather's only son = his father. Father's daughter = his sister.", 'PYQ'),
  Q('rea', 'Series', 'Find the next: 2, 6, 12, 20, 30, ?', ['40', '42', '44', '38'], 1, 'Differences 4,6,8,10,12 → 30+12 = 42.'),
  Q('rea', 'Series', 'Find the next: 3, 6, 11, 18, 27, ?', ['36', '38', '40', '42'], 1, 'Differences 3,5,7,9,11 → 27+11 = 38.'),
  Q('rea', 'Series', 'Letter series: A, C, E, G, ?', ['H', 'I', 'J', 'K'], 1, 'Skip one letter each time → I.'),
  Q('rea', 'Direction', 'A man walks 5 km North, turns right 3 km, turns right 5 km. Displacement from start:', ['3 km East', '5 km', '8 km', '2 km West'], 0, 'N5, E3, S5 → net 3 km East.'),
  Q('rea', 'Data Sufficiency', 'Is A odd? (A) A × an odd number = an odd number. (B) A is not divisible by 2.', ['A alone', 'B alone', 'Both together', 'Either alone', 'Even both not enough'], 3, 'odd×odd = odd → A odd (A alone works). Not divisible by 2 → odd (B alone works). Either alone.', 'PYQ'),
  Q('rea', 'Data Sufficiency', 'What is the 3-digit number? (A) It is divisible by 9. (B) Its first and third digits are 6.', ['A alone', 'B alone', 'Both together', 'Either alone', 'Even both not enough'], 2, '6_6 divisible by 9 → 6+x+6=12+x div by 9 → x=6 → 666. Needs both.', 'PYQ'),
  Q('rea', 'Seating', 'In a row of 6 facing north, A is 3rd from left and B is 5th from left. Persons between them:', ['0', '1', '2', '3'], 1, 'Positions 3 and 5 → position 4 lies between → 1 person.'),
  // ---------- VERBAL ----------
  Q('ver', 'Error Spotting', 'Spot the error: "One of the boys (A)/ have not (B)/ done his (C)/ homework (D)"', ['A', 'B', 'C', 'D'], 1, '"One of the …" takes a singular verb → "has not".'),
  Q('ver', 'Error Spotting', 'Spot the error: "She is senior (A)/ than me (B)/ in the office (C)/ no error (D)"', ['A', 'B', 'C', 'D'], 1, 'senior is followed by TO, not than → "senior to me".'),
  Q('ver', 'Sentence Completion', 'He was ___ tired to walk another step.', ['so', 'too', 'very', 'enough'], 1, '"too … to" expresses excess preventing an action.'),
  Q('ver', 'Sentence Completion', 'Neither of the two answers ___ correct.', ['are', 'is', 'were', 'be'], 1, 'Neither takes a singular verb → is.'),
  Q('ver', 'Prepositions', 'He is good ___ mathematics.', ['in', 'at', 'on', 'with'], 1, 'good AT a skill/subject.'),
  Q('ver', 'Synonyms', 'Synonym of ABUNDANT:', ['scarce', 'plentiful', 'dull', 'rare'], 1, 'Abundant = plentiful.'),
  Q('ver', 'Antonyms', 'Antonym of TRANSPARENT:', ['clear', 'opaque', 'visible', 'bright'], 1, 'Opposite of transparent = opaque.'),
  Q('ver', 'Reading Comp', 'Passage: "Renewable energy sources like solar and wind are inexhaustible and clean, unlike fossil fuels which pollute and run out." — Which is TRUE?', ['Solar runs out quickly', 'Fossil fuels are clean', 'Wind energy is inexhaustible', 'Fossil fuels never pollute'], 2, 'The passage states renewables (incl. wind) are inexhaustible.'),
  // ---------- NUMERICAL (batch 2) ----------
  Q('num', 'Time & Work', 'A finishes a job in 10 days, B in 15. Working together they finish in:', ['5 days', '6 days', '7 days', '8 days'], 1, '1/10 + 1/15 = 1/6 → 6 days.'),
  Q('num', 'Time & Work', 'A and B together finish in 12 days; A alone in 20. B alone takes:', ['24 days', '30 days', '36 days', '40 days'], 1, '1/12 − 1/20 = (5−3)/60 = 1/30 → 30 days.'),
  Q('num', 'Pipes & Cistern', 'A pipe fills a tank in 6 h; a leak empties it in 8 h. Together the tank fills in:', ['20 h', '24 h', '18 h', '30 h'], 1, '1/6 − 1/8 = 1/24 → 24 h.'),
  Q('num', 'Simple Interest', 'SI on ₹5000 at 8% p.a. for 3 years:', ['₹1000', '₹1200', '₹1400', '₹1500'], 1, '5000·8·3/100 = 1200.'),
  Q('num', 'Compound Interest', 'CI on ₹10000 at 10% p.a. for 2 years:', ['₹2000', '₹2100', '₹1000', '₹2200'], 1, '10000·1.1² − 10000 = 2100.'),
  Q('num', 'Ages', 'A father is 3× his son. In 12 years he will be twice as old. Son\'s present age:', ['10', '12', '14', '15'], 1, '3S+12 = 2(S+12) → S = 12.'),
  Q('num', 'Mixtures', 'In what ratio mix 30%-milk and 60%-milk solutions to get 40% milk?', ['2:1', '1:2', '3:2', '1:1'], 0, 'Alligation: (60−40):(40−30) = 20:10 = 2:1.'),
  Q('num', 'Partnership', 'A invests ₹3000, B ₹4000; profit ₹1400. B\'s share:', ['₹600', '₹700', '₹800', '₹750'], 2, 'Ratio 3:4 → B = 1400·4/7 = 800.'),
  Q('num', 'Percentages', 'Winner gets 60% of votes and wins by 200 (2 candidates). Total votes:', ['800', '1000', '1200', '900'], 1, '60−40 = 20% = 200 → total 1000.'),
  Q('num', 'Simplification', '√144 + √169 = ?', ['24', '25', '26', '23'], 1, '12 + 13 = 25.'),
  Q('num', 'Number System', 'Sum of the first 20 natural numbers:', ['200', '210', '220', '190'], 1, '20·21/2 = 210.'),
  Q('num', 'Averages', 'Average of the first 5 even numbers (2,4,6,8,10):', ['5', '6', '7', '8'], 1, '30/5 = 6.'),
  Q('num', 'Progressions', '10th term of the AP 3, 7, 11, …:', ['37', '39', '41', '43'], 1, 'a=3, d=4 → 3 + 9·4 = 39.'),
  Q('num', 'Profit & Loss', 'A shopkeeper marks 40% above cost and gives 10% discount. Profit%:', ['25%', '26%', '30%', '24%'], 1, '1.4·0.9 = 1.26 → 26%.'),
  Q('num', 'Boats & Streams', 'Boat 10 km/h in still water, stream 2 km/h. Downstream speed:', ['8', '12', '10', '14'], 1, '10 + 2 = 12 km/h.'),
  Q('num', 'Boats & Streams', 'Upstream 6 km/h, downstream 10 km/h. Speed of the stream:', ['1', '2', '3', '4'], 1, '(10−6)/2 = 2 km/h.'),
  Q('num', 'Perm & Comb', 'In how many ways can 5 people sit in a row?', ['24', '60', '120', '20'], 2, '5! = 120.'),
  Q('num', 'Perm & Comb', 'Number of ways to choose 2 people from 5:', ['10', '20', '5', '15'], 0, 'C(5,2) = 10.'),
  Q('num', 'Probability', 'A die is rolled once. P(even number):', ['1/2', '1/3', '1/6', '2/3'], 0, '{2,4,6}/6 = 1/2.'),
  Q('num', 'Probability', 'Two fair coins are tossed. P(both heads):', ['1/2', '1/4', '1/3', '3/4'], 1, '½·½ = 1/4.'),
  Q('num', 'Logarithms', 'log₂ 8 = ?', ['2', '3', '4', '8'], 1, '2³ = 8 → 3.'),
  // ---------- REASONING (batch 2) ----------
  Q('rea', 'Coding-Decoding', 'If FRIEND = GSJFOE (each +1), then MOTHER =', ['NPUIFS', 'NPUIGS', 'MPUIFS', 'NQUIFS'], 0, 'Each letter +1: M→N,O→P,T→U,H→I,E→F,R→S.'),
  Q('rea', 'Coding-Decoding', 'If BOOK = DQQM (each +2), then WORD =', ['YQTF', 'YQTG', 'XQTF', 'YRTF'], 0, 'W→Y, O→Q, R→T, D→F.'),
  Q('rea', 'Syllogism', 'Some pens are books. All books are papers. I. Some pens are papers II. Some papers are pens', ['Only I', 'Only II', 'Both I and II', 'Neither'], 2, 'Those pens that are books are papers → I; converse → II.'),
  Q('rea', 'Blood Relations', "'A + B' = A is father of B; 'A − B' = A is wife of B. In P + Q − R, P is R's:", ['Father-in-law', 'Father', 'Brother', 'Uncle'], 0, 'P father of Q; Q wife of R → P is R\'s father-in-law.'),
  Q('rea', 'Number Series', '5, 11, 23, 47, ?', ['95', '94', '96', '93'], 0, 'Each ×2 + 1 → 47·2+1 = 95.'),
  Q('rea', 'Number Series', '1, 1, 2, 3, 5, 8, ?', ['11', '12', '13', '14'], 2, 'Fibonacci → 5 + 8 = 13.'),
  Q('rea', 'Odd One Out', 'Find the odd one: Rose, Lotus, Lily, Mango', ['Rose', 'Lotus', 'Lily', 'Mango'], 3, 'Mango is a fruit; the rest are flowers.'),
  Q('rea', 'Analogy', 'Cat : Kitten :: Dog : ?', ['Cub', 'Puppy', 'Calf', 'Foal'], 1, 'Young of a dog is a puppy.'),
  Q('rea', 'Analogy', 'Doctor : Hospital :: Teacher : ?', ['School', 'Class', 'Book', 'Student'], 0, 'A teacher works in a school.'),
  Q('rea', 'Ranking', 'Ravi is 7th from the top and 26th from the bottom. Total students:', ['31', '32', '33', '34'], 1, '7 + 26 − 1 = 32.'),
  Q('rea', 'Direction', "At sunrise a man's shadow falls towards him. He is facing:", ['East', 'West', 'North', 'South'], 1, 'Sun in the east → shadow to the west; shadow in front → faces west.'),
  Q('rea', 'Seating', '6 people sit around a circle facing centre. If A is exactly opposite D, people between them on each side:', ['1', '2', '3', '0'], 1, '6/2 − 1 = 2 on each side.'),
  // ---------- VERBAL (batch 2) ----------
  Q('ver', 'Error Spotting', 'Spot the error: "The number of students (A)/ in the class (B)/ are fifty (C)/ no error (D)"', ['A', 'B', 'C', 'D'], 2, '"The number of …" takes a singular verb → "is fifty".'),
  Q('ver', 'Error Spotting', 'Spot the error: "He did not (A)/ went (B)/ to school (C)/ yesterday (D)"', ['A', 'B', 'C', 'D'], 1, 'After "did not" use the base verb → "go".'),
  Q('ver', 'Sentence Completion', 'Hardly had he arrived ___ it started to rain.', ['than', 'when', 'then', 'that'], 1, '"Hardly … when" is the fixed pair.'),
  Q('ver', 'Sentence Completion', 'She has been living here ___ 2010.', ['for', 'since', 'from', 'by'], 1, '"since" + a point in time.'),
  Q('ver', 'Prepositions', 'He is married ___ a doctor.', ['with', 'to', 'by', 'of'], 1, 'married TO.'),
  Q('ver', 'Synonyms', 'Synonym of BENEVOLENT:', ['cruel', 'kind', 'weak', 'proud'], 1, 'Benevolent = kind, generous.'),
  Q('ver', 'Antonyms', 'Antonym of OPTIMIST:', ['dreamer', 'pessimist', 'realist', 'idealist'], 1, 'Opposite of optimist = pessimist.'),
  Q('ver', 'Antonyms', 'Antonym of CONDEMN:', ['blame', 'praise', 'punish', 'judge'], 1, 'Condemn (blame) ↔ praise.'),
  Q('ver', 'One Word', 'One who cannot read or write:', ['ignorant', 'illiterate', 'innocent', 'novice'], 1, 'illiterate.'),
  Q('ver', 'Spelling', 'Choose the correctly spelt word:', ['Occurrence', 'Occurence', 'Ocurrence', 'Occurrance'], 0, 'Occurrence — double c, double r.'),
  Q('ver', 'Voice', 'Passive of "She writes a letter.":', ['A letter is written by her', 'A letter was written by her', 'A letter is being written by her', 'A letter has written by her'], 0, 'Simple-present passive: is + written.'),
  Q('ver', 'Idioms', '"To burn the midnight oil" means:', ['to waste money', 'to work late at night', 'to sleep early', 'to cause trouble'], 1, 'To study/work late into the night.'),
  Q('ver', 'Para-jumble', 'Order the parts: P. and then went home  Q. He finished his work  R. in the evening', ['QRP', 'QPR', 'RQP', 'PQR'], 0, '"He finished his work / in the evening / and then went home." → Q R P.'),
  // ---------- BATCH 3 ----------
  Q('num', 'Data Interpretation', 'A shop sells 200 items: 25% pens, 40% books, the rest notebooks. Number of notebooks:', ['70', '80', '60', '50'], 0, 'Notebooks = 100 − 25 − 40 = 35% of 200 = 70.'),
  Q('num', 'Averages', 'Average of 6 numbers is 30. Two numbers averaging 20 are removed. New average:', ['33', '35', '34', '36'], 1, 'Sum 180 − 40 = 140 over 4 → 35.'),
  Q('num', 'Simple Interest', 'A sum doubles in 5 years at simple interest. The rate p.a. is:', ['15%', '20%', '25%', '10%'], 1, 'Interest = principal → 100 = R·5 → R = 20%.'),
  Q('num', 'Time & Work', '12 men complete a job in 10 days. 8 men complete the same job in:', ['15 days', '12 days', '18 days', '20 days'], 0, 'Men·days constant: 12·10 = 8·d → d = 15.'),
  Q('rea', 'Statement-Conclusion', 'Statement: "Smoking is injurious to health." I. One should not smoke. II. Health is wealth.', ['Only I', 'Only II', 'Both', 'Neither'], 0, 'I directly follows; II is unrelated general saying.'),
  Q('rea', 'Letter Series', 'Z, X, V, T, ?', ['R', 'S', 'Q', 'U'], 0, 'Each −2 letters → T−2 = R.'),
  Q('rea', 'Blood Relations', 'Q is the son of P. P is the sister of R. How is R related to Q?', ['Uncle/Aunt', 'Father', 'Brother', 'Grandfather'], 0, "R is a sibling of Q's parent → uncle or aunt."),
  Q('rea', 'Number Series', '7, 14, 28, 56, ?', ['112', '110', '108', '96'], 0, 'Each ×2 → 56·2 = 112.'),
  Q('ver', 'Synonyms', 'Synonym of DILIGENT:', ['lazy', 'hardworking', 'careless', 'slow'], 1, 'Diligent = hardworking, industrious.'),
  Q('ver', 'Antonyms', 'Antonym of SCARCE:', ['rare', 'abundant', 'few', 'limited'], 1, 'Scarce ↔ abundant.'),
  Q('ver', 'Grammar', 'If I ___ rich, I would travel the world.', ['am', 'was', 'were', 'be'], 2, 'Second conditional uses "were" for all subjects.'),
  Q('ver', 'Reading Comp', 'Passage: "Regular exercise strengthens the heart, improves mood, and boosts energy — its benefits go well beyond weight loss." Best conclusion:', ['Exercise only helps weight loss', 'Exercise has broad benefits', 'Exercise worsens mood', 'Exercise weakens the heart'], 1, 'The passage stresses benefits beyond weight loss.'),
];

// ---- coding problems (advanced section prep) ----
export const CODING = [
  {
    title: 'Reverse each word (keep order)', diff: 'Easy',
    statement: 'Given a sentence, reverse the letters of each word but keep the word order. Input: "hello world" → Output: "olleh dlrow".',
    approach: 'Split on spaces, reverse each token, join back. Watch for multiple spaces / trailing newline.',
    code: `s = input()
print(' '.join(w[::-1] for w in s.split(' ')))`,
  },
  {
    title: 'Second largest in an array', diff: 'Easy',
    statement: 'Read N then N integers; print the second-largest distinct value. Handle duplicates and N<2.',
    approach: 'Track largest & second in one pass. Use distinct check; if no valid second, print -1.',
    code: `n = int(input()); a = list(map(int, input().split()))
first = second = float('-inf')
for x in a:
    if x > first: second, first = first, x
    elif first > x > second: second = x
print(second if second != float('-inf') else -1)`,
  },
  {
    title: 'Maximum subarray sum (Kadane)', diff: 'Medium',
    statement: 'Given N integers (may be negative), find the maximum sum of any contiguous subarray.',
    approach: "Kadane: run = max(x, run+x); best = max(best, run). Init with first element so all-negative arrays work.",
    code: `n = int(input()); a = list(map(int, input().split()))
best = run = a[0]
for x in a[1:]:
    run = max(x, run + x)
    best = max(best, run)
print(best)`,
  },
  {
    title: 'Count pairs with a given sum', diff: 'Medium',
    statement: 'Given N integers and a target K, count the number of pairs (i<j) with a[i]+a[j] = K.',
    approach: 'Hash map of seen counts; for each x add count of (K−x) seen so far. O(N).',
    code: `from collections import defaultdict
n, k = map(int, input().split()); a = list(map(int, input().split()))
seen = defaultdict(int); cnt = 0
for x in a:
    cnt += seen[k - x]
    seen[x] += 1
print(cnt)`,
  },
  {
    title: 'Palindrome check', diff: 'Easy',
    statement: 'Read a string; print "YES" if it reads the same forwards and backwards (ignore case), else "NO".',
    approach: 'Lowercase the string and compare it with its reverse.',
    code: `s = input().strip().lower()
print("YES" if s == s[::-1] else "NO")`,
  },
  {
    title: 'First non-repeating character', diff: 'Medium',
    statement: 'Given a string, print the first character that appears exactly once. If none exists, print "_".',
    approach: 'Count all characters (Counter), then scan left→right for the first with count 1.',
    code: `from collections import Counter
s = input()
c = Counter(s)
for ch in s:
    if c[ch] == 1:
        print(ch); break
else:
    print("_")`,
  },
];
