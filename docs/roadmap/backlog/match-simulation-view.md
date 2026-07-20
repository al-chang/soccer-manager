# Functional Specification: Match Simulation Screen

The match simulation screen is the crucible of the game—the space where pre-match preparation is tested against a dynamic, unfolding sports narrative. The interface functions as a high-stakes command center, balancing real-time data consumption with rapid tactical decision-making.

---

## 1. The Broadcast Header (Top Bar)

This zone remains pinned to the top of the viewport throughout the match, providing immediate situational awareness without requiring the user to scroll or switch tabs.

- **Scoreboard & Timer:** The system must continuously display the home and away team names, the current score, the match minute, and a ticking second indicator to communicate live progression.
- **Time & Pacing Controls:** Users must be able to manipulate the flow of time through standard media controls:
  - **Play / Pause:** Halts or resumes the match simulation instantly.
  - **Simulation Speed:** A toggle cycling through standard playback speeds (`1x`, `2x`) and an "Instant Result" option that skips directly to the final whistle.
- **Match Momentum Indicator:** A horizontal bar chart that updates at regular intervals (e.g., every 5 match minutes) to show which team is currently dominating territorial control and offensive pressure. The visual balance must shift dynamically to signal when the tide of the game is turning against the user.

---

## 2. The Action Viewport (Center Stage)

This is the primary narrative focus of the screen, responsible for translating the unseen simulation math into a digestible football match.

- **Dual-View Toggle:** The user must be able to switch between two distinct presentation modes at will:
  - **Spatial Pitch View:** A top-down 2D representation of a football pitch showing simplified player markers moving across zones, tracking ball trajectory, and demonstrating team formations in real time.
  - **Technical Rendering Constraint:** This visualizer should be built using the HTML5 Canvas API (rather than standard DOM elements like `<div>` or `<svg>`). The Canvas engine must handle the high-frame-rate spatial animation and coordinate interpolation to guarantee a smooth 60 FPS rendering of moving player entities without causing browser layout thrashing or DOM reflow bottlenecks.
  - **Text Commentary Feed:** A vertically scrolling, timestamped ticker that describes match events in natural language. Important events (goals, yellow/red cards, injuries) must be highlighted using distinct color coding and bold typography.
- **Event Filtering:** In the text commentary feed, users must be able to filter the verbosity of the output (e.g., viewing "All Events", "Key Chances Only", or "Goals & Cards Only") to reduce visual noise during high-speed simulation.

---

## 3. Live Match Analytics

To make informed tactical changes, users need access to real-time comparative data without obscuring the action viewport.

- **Comparative Statistical Feed:** The screen must display side-by-side progress bars comparing the home and away teams across core performance metrics:
  - Possession (%)
  - Total Shots / Shots on Target
  - Expected Goals (xG)
  - Pass Completion Rate (%)
  - Fouls and Corner Kicks
- **Player Performance Leaderboard:** A quick-reference panel highlighting standout individual performers on the pitch (e.g., highest match rating, most distance covered, or most key passes made).

---

## 4. The Tactical Dugout (Lower Control Panel)

This zone allows the manager to monitor the physical and mental state of their squad and execute real-time personnel changes.

- **Active Squad Grid:** A structured list or formation map displaying all 11 players currently on the pitch for the user's team. Each player entry must display:
  - **Live Match Rating:** A dynamic score from `1.0` to `10.0` that updates in real time based on their on-pitch actions (passes completed, tackles won, shots missed).
  - **Physical Condition:** A depleting progress bar indicating current fatigue. The system must trigger a visual warning (e.g., color shift to yellow or red) when a player's condition drops below an optimal threshold.
  - **Status Badges:** Icons that appear dynamically next to a player's name to indicate yellow cards, red cards, or physical injuries (differentiating between a minor "knock" where they can play on, and a severe injury requiring immediate substitution).
- **Substitutions Bench:** A panel displaying available substitute players. The user must be able to initiate a substitution by selecting an active player and selecting a benched player.
- **Substitution Execution Logic:** When a substitution is commanded, the system must queue the change and execute it at the next logical stoppage in play (e.g., ball out of bounds, foul, or goal), decrementing the user's remaining available substitutions.

---

## 5. Real-Time Tactical Interactivity

The user must be able to influence the match without necessarily pausing the simulation clock.

- **Quick-Access Mentality Sliders:** A horizontal control allowing the user to instantly adjust the team's global risk appetite, scaling from _All-Out Defense_ to _All-Out Attack_.
- **Tactical Pause & Deep Overrides:** A dedicated button that pauses the match and opens a comprehensive tactical overlay where users can rearrange their formation, swap individual player roles, or alter pressing instructions before resuming play.

---

## 6. High-Impact Event Overlays

When critical, game-changing moments occur in the simulation, the normal UI must temporarily yield attention to dramatize the event.

| Event Type          | System Behavior                                                                                                              | User Interaction Required                                                                               |
| :------------------ | :--------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| **Goal Scored**     | Pause simulation clock; trigger a high-contrast visual banner displaying the scorer, assist provider, and updated scoreline. | Click "Continue" or wait for a 5-second auto-resume timer.                                              |
| **Severe Injury**   | Pause simulation clock; flash a medical alert detailing the injured player and estimated severity.                           | **Mandatory:** User must open the dugout and substitute the injured player before the match can resume. |
| **Red Card**        | Pause simulation clock; display a disciplinary banner showing the dismissed player.                                          | **Optional:** User is prompted to adjust their formation to account for being down to 10 men.           |
| **Penalty Awarded** | Briefly slow simulation speed to `1x`; display a tension-building "Penalty Kick" notification before resolving the shot.     | None (passive dramatic pause).                                                                          |

---

## 7. Match Conclusion Workflow

The screen must handle the transition from live gameplay back into the macro management loop cleanly.

- **Final Whistle Freeze:** At the conclusion of stoppage time, the simulation clock must halt, and the action viewport must freeze on the final pitch state.
- **Post-Match Summary Modal:** A concluding overlay must automatically appear presenting the final score, the official Player of the Match award, a bulleted summary of key turning points, and a primary action button to "Return to Locker Room / Inbox."
