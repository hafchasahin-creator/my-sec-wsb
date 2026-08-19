# The Black Hole Information Paradox

## 0. Conventions

Units are ℏ = c = k_B = 1, with Newton's constant G kept explicit. For a state ρ, S(ρ) = −Tr ρ ln ρ is the von Neumann (fine-grained) entropy; S_BH = A/4G is the Bekenstein–Hawking (coarse-grained, thermodynamic) entropy. The Hawking temperature is T_H = κ/2π, equal to 1/8πGM for Schwarzschild. Frequencies ω are Killing frequencies conjugate to Schwarzschild time at infinity. Unless noted otherwise, the discussion is at the level of a free field on a fixed collapse background, with backreaction and greybody factors suppressed.

## 1. The paradox in density-matrix language

**Initial state.** Collapsing matter is prepared in a pure state, ρ₀ = |ψ⟩⟨ψ|, so S(ρ₀) = 0.

**During evaporation.** The Bogoliubov transformation relating the in-vacuum to the out-mode basis is a two-mode squeezing operation: the in-vacuum, expressed in out-modes, is a product over modes of pair-correlated states, each pairing an exterior mode b with an interior partner b̃. Mode by mode,

    |ψ⟩_pair = √(1 − e^{−ω/T_H}) Σₙ e^{−nω/2T_H} |n⟩_b̃ |n⟩_b

for a bosonic field (for fermions the sum truncates at n = 1 and the weights adjust accordingly). Tracing out the partner behind the horizon leaves

    ρ_b = (1 − e^{−ω/T_H}) Σₙ e^{−nω/T_H} |n⟩⟨n| ,

an exactly thermal state at T_H. The exactness is a property of the idealization: for a realistic collapse the asymptotic flux is thermal only up to greybody factors, ⟨n_ω⟩ = Γ_{ωℓm} / (e^{ω/T_H} ∓ 1), and only at late times. Neither refinement affects the argument.

The outside radiation is mixed *only* because its purifier sits behind the horizon. Each emitted quantum adds entanglement entropy, so S_rad grows monotonically, while A/4G shrinks.

**Final state.** The hole evaporates away. The interior partners go with it. What remains is ρ_rad, mixed, with S(ρ_rad) > 0.

**Pure → mixed.** Once evaporation is complete, the radiation *is* the entire system: there is nothing left to purify it. Unitary evolution acts as ρ → UρU†, which preserves von Neumann entropy exactly, so it cannot map a pure ρ₀ to a mixed final state on the same Hilbert space. Hawking's process is therefore not describable by any S-matrix; he proposed replacing it with a non-unitary "superscattering" map $ (Hawking 1976). That is the paradox, stated precisely.

## 2. Four assumptions that cannot all hold

The now-standard packaging of the AMPS argument (Almheiri, Marolf, Polchinski, Sully 2012) rests on four claims:

- **U — Unitarity.** The full state stays pure; information returns in the radiation. Equivalently, to a distant observer the hole behaves as an ordinary quantum system with a discrete spectrum and ≈ e^{A/4G} states.
- **E — Semiclassical effective field theory outside.** Hawking's calculation is valid; ordinary local physics holds outside (in AMPS's phrasing, outside the stretched horizon).
- **S — Smooth horizon ("no drama").** By the equivalence principle, a freely falling observer sees the local vacuum as they cross.
- **M — Monogamy of entanglement.** A system cannot be maximally entangled with two independent systems at once. This is a theorem of ordinary quantum mechanics; it follows from strong subadditivity (SSA) of the von Neumann entropy — not, as is sometimes said, equivalent to it.

Now consider a single late Hawking quantum b, emitted after the Page time.

- **U + E force** b to be nearly maximally entangled with the early radiation R. Reason: S_rad must turn around and fall to zero, and S(Rb) < S(R) requires b to be entangled with R.
- **S + E force** b to be nearly maximally entangled with its interior partner b̃. "Local vacuum" is not an empty condition: the vacuum *is* the state in which near-horizon modes are entangled across the horizon at short distances.
- **M forbids both.** b cannot be nearly maximally entangled with R and with b̃ simultaneously.

So at least one assumption must be abandoned:

- **Drop U** → Hawking's original position: information is destroyed. This conflicts with the linearity and unitarity of quantum mechanics itself, and with AdS/CFT, where the boundary evolution is manifestly unitary.
- **Drop E** → the semiclassical description near or outside the horizon fails, in a subtle and probably nonlocal way, even where curvature is small and the local state looks unremarkable.
- **Drop S** → a *firewall*: the short-distance entanglement across the horizon is broken. Breaking it means the state is far from the local vacuum, which costs a large energy density in the infalling frame; the infaller is destroyed at the horizon rather than falling through.
- **Drop M** → abandon standard Hilbert-space quantum mechanics. Essentially no one takes this route.

Two further options deny premises implicit in the setup rather than one of the four: *remnants* (the evaporation never completes, so the purifier survives in a Planck-scale object) and *final-state projection* (Horowitz–Maldacena 2003), which imposes a boundary condition at the singularity. Both carry well-known costs — an infinite species problem for remnants, a modification of interior dynamics for the final-state proposal. AMPS itself was formulated as a critique of black hole complementarity ('t Hooft; Susskind–Thorlacius–Uglum), which had been the standard way of holding U, E, and S together.

## 3. The Page curve

Let S_rad(t) be the fine-grained entropy of everything emitted up to time t.

**Hawking's answer.** S_rad rises monotonically for the entire evaporation, since each quantum is separately thermal and uncorrelated with the rest. The final value is of order the initial Bekenstein–Hawking entropy and in fact exceeds it by an O(1) factor — about 4/3 for Schwarzschild emission into massless quanta (Zurek 1982; Page 1983), because thermal emission is not a reversible process.

**Unitarity's answer (Page 1993).** The fine-grained entropy is bounded by both the coarse-grained entropy of the radiation and the remaining black hole entropy:

    S_rad(t) ≲ min( S_rad^coarse(t), S_BH(t) ) .

It rises while the radiation is the smaller subsystem, turns over at the **Page time** — defined as the moment the two bounds cross — then falls, tracking the shrinking A/4G, and reaches zero when the hole disappears. In the idealized counting where the radiation's coarse-grained entropy is just the entropy the hole has lost, the crossing is at exactly half the initial entropy, i.e. M = M₀/√2 for Schwarzschild (S_BH ∝ M²). Restoring the O(1) irreversibility factor above shifts it slightly, to S_BH ≈ (4/7) S_BH,init; either way the Page time falls somewhat past the midpoint of the hole's lifetime, with the precise fraction depending on the emitted species.

The turnover is not optional: it is what "the final state is pure" looks like as a curve. And it sharpens the difficulty — after the Page time, every newly emitted quantum must *decrease* the radiation's entropy, which means it must already be entangled with what came out before.

The modern derivation recovers the descending branch from gravity itself. Applying the quantum extremal surface prescription (Engelhardt–Wall 2014) to the radiation, one extremizes the generalized entropy

    S_gen(I) = Area(∂I)/4G + S_semicl(R ∪ I)

over candidate "island" regions I. Before the Page time the empty island dominates and one recovers Hawking's rising curve; after it, an island covering most of the interior takes over and the answer tracks A/4G (Penington 2019; Almheiri–Engelhardt–Marolf–Maxfield 2019). The replica-wormhole calculations (Penington–Shenker–Stanford–Yang 2019; Almheiri–Hartman–Maldacena–Shaghoulian–Tajdini 2019) derive this from the gravitational path integral: the island contribution comes from replica-symmetric wormhole saddles that the naive semiclassical entropy formula omits. What fails is not local physics at the horizon but the *entropy formula* applied naively to the semiclassical state.

## 4. AMPS, made explicit

AMPS sharpened the tension into a contradiction using strong subadditivity. With A = R (early radiation), B = b (the late Hawking mode), C = b̃ (its interior partner), SSA in the form S(AB) + S(BC) ≥ S(B) + S(ABC) reads

    S(Rb) + S(b b̃) ≥ S(b) + S(R b b̃) .

A smooth horizon requires b and b̃ to be in a pure state together, so S(b b̃) = 0. Purity of the joint state bb̃ already forces ρ_{R b b̃} = ρ_R ⊗ ρ_{b b̃}, hence S(R b b̃) = S(R); decoupling from R is a consequence, not an extra assumption. Substituting,

    S(Rb) ≥ S(R) + S(b) .

Combined with subadditivity, S(Rb) ≤ S(R) + S(b), this forces the entropy to be exactly additive: the radiation entropy increases by S(b) with every emission — Hawking's rising curve, forever. It contradicts the Page curve's requirement that S(Rb) < S(R) after the Page time.

The three roles, plainly:

- **Early radiation R.** After the Page time it is large enough to purify the remaining hole, so it claims the entanglement of each new quantum.
- **Late mode b.** The contested quantum; both R and b̃ need it.
- **Interior partner b̃.** Smoothness needs it entangled with b, but R got there first.

AMPS's "most conservative" conclusion was to keep U, E, and M and sacrifice the smooth horizon. The horizon becomes a firewall — and since the interior geometry was built out of precisely those partner modes, there may be no interior at all.

## 5. Where this stands

Two escape routes are taken seriously, and they are closely related.

**ER = EPR** (Maldacena–Susskind 2013) holds that b̃ and the appropriate degrees of freedom in R are not independent tensor factors but the same degrees of freedom described two ways, connected by a geometric bridge. Monogamy is then never violated, because the assumed factorization of the Hilbert space — an aspect of E, not of M — was wrong. The interior is nonlocally encoded in the radiation.

**Harlow–Hayden** (2013) attacked the operational side: the measurement that would expose the contradiction requires *decoding* the radiation to distill b's partner from R, and that task is computationally intractable. They abstracted the operation into a well-posed decoding task and showed it to be QSZK-hard: a polynomial-time solution for generic circuits would imply SZK ⊆ BQP. Aaronson (2016) strengthened the evidence, basing hardness instead on the existence of injective one-way functions. Under either assumption the decoding time grows exponentially in the number of radiation qubits, while the hole's remaining lifetime is only polynomial in that number — so no observer can complete the measurement before the hole is gone. The horizon is protected by computational complexity rather than by physics.

The island results lend weight to the first line: they reproduce the Page curve with no firewall and with the interior encoded in the radiation, indicating that assumption **E**, in its naive local form, is the one that breaks. What they do not yet settle is the infalling observer's experience — how the island encoding is realized as a bulk description for someone who crosses the horizon remains an open question.

## References

- S. W. Hawking, *Particle creation by black holes*, Commun. Math. Phys. **43** (1975) 199.
- S. W. Hawking, *Breakdown of predictability in gravitational collapse*, Phys. Rev. D **14** (1976) 2460.
- W. H. Zurek, *Entropy evaporated by a black hole*, Phys. Rev. Lett. **49** (1982) 1683.
- D. N. Page, *Average entropy of a subsystem*, Phys. Rev. Lett. **71** (1993) 1291 [gr-qc/9305007]; *Information in black hole radiation*, Phys. Rev. Lett. **71** (1993) 3743 [hep-th/9306083].
- L. Susskind, L. Thorlacius, J. Uglum, *The stretched horizon and black hole complementarity*, Phys. Rev. D **48** (1993) 3743 [hep-th/9306069].
- G. T. Horowitz, J. Maldacena, *The black hole final state*, JHEP **0402** (2004) 008 [hep-th/0310281].
- A. Almheiri, D. Marolf, J. Polchinski, J. Sully, *Black holes: complementarity or firewalls?*, JHEP **1302** (2013) 062 [arXiv:1207.3123].
- D. Harlow, P. Hayden, *Quantum computation vs. firewalls*, JHEP **1306** (2013) 085 [arXiv:1301.4504].
- J. Maldacena, L. Susskind, *Cool horizons for entangled black holes*, Fortsch. Phys. **61** (2013) 781 [arXiv:1306.0533].
- N. Engelhardt, A. C. Wall, *Quantum extremal surfaces*, JHEP **1601** (2016) 004 [arXiv:1408.3203].
- S. Aaronson, *The complexity of quantum states and transformations: from quantum money to black holes* [arXiv:1607.05256].
- G. Penington, *Entanglement wedge reconstruction and the information paradox*, JHEP **09** (2020) 002 [arXiv:1905.08255].
- A. Almheiri, N. Engelhardt, D. Marolf, H. Maxfield, *The entropy of bulk quantum fields and the entanglement wedge of an evaporating black hole*, JHEP **12** (2019) 063 [arXiv:1905.08762].
- G. Penington, S. H. Shenker, D. Stanford, Z. Yang, *Replica wormholes and the black hole interior*, JHEP **03** (2022) 205 [arXiv:1911.11977].
- A. Almheiri, T. Hartman, J. Maldacena, E. Shaghoulian, A. Tajdini, *Replica wormholes and the entropy of Hawking radiation*, JHEP **05** (2020) 013 [arXiv:1911.12333].
