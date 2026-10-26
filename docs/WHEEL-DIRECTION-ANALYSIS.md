# REVO FIXER — Wheel Direction Analysis

This is an isolated, opt-in analysis panel. It does not change the existing Signal Card, predictor, scraper, API routes, polling, or result records.

## How to use it

1. Open REVO FIXER over HTTPS in a browser that supports screen sharing.
2. Select **Start screen tracking** and share the window/tab containing the large Crazy Time wheel.
3. In the preview, click the centre of the large wheel and then a point on its outer rim.
4. Wait until the motion quality reports **GOOD**. If visibility or frame matching is poor, the direction remains unknown.
5. Choose the exact pocket at the fixed pointer from the reference-pocket list. The selected index is a pocket position, not a result category.
6. Press **Record five-segment observation** before the confirmed result arrives.
7. The read-only `crazy_results` Firebase feed is used to settle the observation by round ID. Outcomes whose timestamps predate candidate generation are recorded as INVALID, not scored.
8. Export the CSV to back up this browser's separate analysis history.

Screen capture and analysis are local to the browser. History is stored in `localStorage`; it is not written into Firebase or the original result history.

## Wheel order

`WHEEL_ORDER` uses the 54-pocket clockwise sequence specified in Pennsylvania Code, Chapter 690, §690.1(b): https://www.pacodeandbulletin.gov/secure/pacode/data/058/chapter690/058_0690.pdf

The app still requires a human to select the pocket currently at the fixed pointer. Confirm the exact visual orientation of the source wheel and pointer before collecting observations. Direction maps to the next pocket moving under the fixed pointer: clockwise motion uses the previous clockwise index; counterclockwise motion uses the next index.

## Scoring and baseline

- Candidate sets are saved before the result is known.
- Each round ID is settled at most once.
- HIT means the confirmed outcome category appears in the five candidate pockets; MISS means it does not; INVALID means the observation or timestamp was unsuitable.
- The baseline is calculated from the wheel-layout frequencies of the distinct candidate outcome categories. It is a reference rate, not a prediction.
- The dashboard reports observed history only. It does not claim that wheel direction predicts outcomes or that the feature has betting value.
- Existing result data is read-only. No historical outcomes are synthesized or changed.

## Tests

Run `npm test` to test the 54-pocket count and category distribution, clockwise/counterclockwise index order, result normalization, HIT/MISS/INVALID scoring, baseline calculation, statistics, and synthetic signature motion.
