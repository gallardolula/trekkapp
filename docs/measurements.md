# Measurements

Two requirements put a number on behaviour rather than on a feature, and a
number is a claim until somebody takes it. This records how each is measured,
what the instrument is, and what it has returned so far.

Nothing here is estimated. Every figure in this file came out of a run, and a
row with no figure says so rather than carrying a plausible one.

## RNF02. Evaluating a position against the track

> La evaluación de la posición contra una traza de cinco mil puntos no debe
> superar los cincuenta milisegundos.

The function under measurement is `distanceToTrack` in `src/domain/geo.ts`. It
walks every segment of the track and keeps the nearest, and it runs on every
reading of the receiver during a hike, so it is what the deviation alert waits
for.

### Instrument

`src/domain/benchmark.ts`, used from two places so the figures are comparable:

- `src/domain/__tests__/performance.test.ts` runs it on the development
  machine on every `npm test`, prints the figures and fails the suite if the
  budget is exceeded.
- The **Mediciones** screen in the application runs the same code on the
  device, reached from Perfil.

The track is generated winding rather than straight. On a straight track the
nearest segment is found early and never beaten, which is the cheapest path
through the loop and would flatter the result.

The figure reported is the p95 and not the mean, because a budget is about the
slow case. Twenty evaluations are discarded first so what is measured is the
steady state and not the engine compiling the function.

### Figures

Development machine, Apple Silicon, Node under Jest, 9 November 2026:

| Points | Median | p95 | Max | Budget |
| --- | --- | --- | --- | --- |
| 1000 | 0.98 ms | 1.02 ms | 1.03 ms | 50 ms |
| 2500 | 2.48 ms | 2.55 ms | 2.60 ms | 50 ms |
| **5000** | **4.91 ms** | **5.05 ms** | 5.15 ms | **50 ms** |
| 10000 | 9.88 ms | 17.25 ms | 18.85 ms | 50 ms |

At the size the requirement names the cost is **4.9 ms against a budget of
50**, which is a tenfold margin. Quadrupling the points multiplies the cost by
3.94, so the cost is linear in the length of the track, as a single pass over
the segments should be. The requirement holds at twice the size it names.

Device figures: **not yet taken.** Run the Mediciones screen on the phone and
record them here. They are the ones that answer the requirement, because the
engine on a device is Hermes and is slower on this kind of numeric loop than
the one a laptop runs. The margin above is wide enough that the result is not
in doubt, but the number has to be taken rather than assumed.

## RNF04. Battery during navigation

> El consumo de batería durante la navegación con pantalla apagada no debe
> superar el diez por ciento por hora.

### Instrument

Reading and storage in `src/data/battery.ts`, arithmetic in
`src/domain/battery.ts`, operated from the **Mediciones** screen.

A session is started, the phone is locked and carried, and the session is
stopped on return. Readings are taken every minute while the application is
awake and written to `battery_samples` on the device, so a locked screen costs
resolution and not the measurement: the rate comes from the first and last
readings and the ones between show whether the drain was even.

Three rules keep the arithmetic honest, and each has a test:

- Readings taken on the charger are recorded and then excluded. A phone on a
  cable says nothing about consumption, and including one turns a plugged-in
  walk into a flattering result.
- A session under five minutes reports no rate at all rather than a noisy one.
- Charge lost comes out positive, and a phone that gained charge off the
  charger reports a negative rate rather than hiding it, because that means
  the measurement is wrong and it should look wrong.

### Figures

**Not yet taken.** This one cannot be shortened: it needs a device, a walk and
the time the walk takes. For the figure to mean what the requirement says, the
session should run with the screen off and the application navigating a
downloaded trail, which is the condition the requirement describes.

A second session with the application merely open and not navigating gives the
baseline the first should be read against, since some of the drain belongs to
the phone and not to this application.

| Session | Conditions | Minutes | Rate | Budget |
| --- | --- | --- | --- | --- |
| | navigating, screen off | | | 10 %/h |
| | idle baseline, screen off | | | |

## What is not measured

RNF03, the fifteen seconds between the reading that confirms a deviation and
the alert, follows from the sampling interval and the hysteresis rather than
from a measurement, and is covered by the rules tests. It is listed here so
that the absence is deliberate rather than overlooked.
