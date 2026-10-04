# Review: the globe's click targets against neighbouring countries

*3 October 2026. All 47 countries, each with the globe turned to face it, at default zoom.*

## Method

For each country the dot was probed at its centre, at 60% of its radius, on its rim, and 5px and 9px outside the rim, from eight directions (33 points), and the country picked at each point recorded (`pick.js`: the dot's drawn radius plus a margin, nearest centre wins). Run on a 1920×1080 desktop with a mouse and a 375×812 phone with touch.

## Findings

### Desktop (1920×1080, mouse)

| Where the click lands | Countries whose dot answers there in every direction |
| --- | ---: |
| Centre of the dot | 47 of 47 |
| Inside the dot | 46 of 47 |
| On its rim | 44 of 47 |
| 5px outside | 41 of 47 |
| 9px outside | 37 of 47 |

Closest pairs of dots (centre to centre):

| Pair | Apart | Dot radii |
| --- | ---: | --- |
| lebanon – palestine | 13.1px | 7.9px, 7.3px |
| syria – lebanon | 15.2px | 13.5px, 7.9px |
| el-salvador – honduras | 15.6px | 7.3px, 7.3px |
| iraq – syria | 29.9px | 11px, 13.5px |
| turkey – syria | 30.1px | 10.4px, 13.5px |
| kuwait – iraq | 31.3px | 7.3px, 11px |
| afghanistan – pakistan | 33.5px | 9.1px, 11.6px |
| kenya – uganda | 36px | 8.5px, 7.3px |
| bangladesh – burma | 37.2px | 11.6px, 7.9px |

5 countries have another dot within 20px; 19 within 44px (a fingertip).

### Phone (375×812, touch)

| Where the click lands | Countries whose dot answers there in every direction |
| --- | ---: |
| Centre of the dot | 47 of 47 |
| Inside the dot | 46 of 47 |
| On its rim | 44 of 47 |
| 5px outside | 30 of 47 |
| 9px outside | 19 of 47 |

Closest pairs of dots (centre to centre):

| Pair | Apart | Dot radii |
| --- | ---: | --- |
| lebanon – palestine | 5.1px | 3.1px, 2.8px |
| syria – lebanon | 5.9px | 5.2px, 3.1px |
| el-salvador – honduras | 6.1px | 2.8px, 2.8px |
| iraq – syria | 11.6px | 4.3px, 5.2px |
| turkey – syria | 11.7px | 4px, 5.2px |
| kuwait – iraq | 12.2px | 2.8px, 4.3px |
| afghanistan – pakistan | 13px | 3.6px, 4.5px |
| kenya – uganda | 14px | 3.3px, 2.8px |
| bangladesh – burma | 14.5px | 4.5px, 3.1px |

23 countries have another dot within 20px; 46 within 44px (a fingertip).

## What it means

- **Desktop:** every dot selects its own country at its centre, and 44 of 47 across their whole area. The three exceptions are Lebanon, Palestine and Syria, whose dots physically overlap (13–15px between centres); where two overlap, the nearer centre wins, and the hover ring and label show which country a click will open.
- **Phone:** the dots are about 3px in radius and many are closer together than a fingertip is wide (Lebanon and Palestine are 5px apart; even at full zoom, 16px). A tap among them cannot be read reliably, so an ambiguous tap opens a short chooser of the nearby countries instead of guessing (`pick.js`: `dotsInReach`, ambiguity rule).
- A country's border is only used when no dot is in reach, so a neighbour's territory never outranks a dot.

