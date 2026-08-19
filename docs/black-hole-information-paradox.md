# The Black Hole Information Paradox: A Precise Statement

**Conventions.** Units are $\hbar = c = k_B = 1$, with Newton's constant $G$ kept explicit. The von Neumann entropy of a state $\rho$ is $S(\rho) = -\operatorname{Tr}(\rho \ln \rho)$; "entropy" without qualification means this fine-grained quantity. The Bekenstein–Hawking entropy $S_{\rm BH} = A/4G$ is, by contrast, a coarse-grained (thermodynamic) quantity, and the paradox is precisely a statement about the relation between the two.

---

## 1. The paradox in density-matrix language

### 1.1 Initial state: pure

Matter prepared in a pure state $|\psi_0\rangle$ undergoes gravitational collapse. The initial density matrix is

$$\rho_0 = |\psi_0\rangle\langle\psi_0|, \qquad S(\rho_0) = 0 .$$

### 1.2 Evaporation: the pair-creation structure

Hawking's calculation treats quantum fields on a fixed collapse background. Its central structural result is that the late-time out-state is *not* a state of the exterior alone. For each field mode of frequency $\omega$ — measured with respect to the Killing time of the asymptotically flat region — the state correlates an outgoing exterior mode $b_\omega$ with an interior partner mode $\tilde b_\omega$ in a two-mode squeezed state:

$$|\Psi\rangle \;=\; \bigotimes_\omega \left(1 - e^{-\omega/T_H}\right)^{1/2} \sum_{n=0}^{\infty} e^{-n\omega/2T_H}\, |n\rangle_{\tilde b_\omega} \otimes |n\rangle_{b_\omega},$$

where $T_H = \kappa/2\pi$ is the Hawking temperature ($\kappa = 1/4GM$ and $T_H = 1/8\pi G M$ for Schwarzschild). This is the Bogoliubov statement that the in-vacuum is a squeezed state in the out-mode basis; equivalently $\tanh r = e^{-\omega/2T_H}$, so the per-quantum suppression factor $e^{-\omega/2T_H}$ is fixed by the analytic structure of the modes across the horizon, not by any thermodynamic input.

*(Written for a bosonic field; for a fermionic field the sum terminates at $n=1$ and the normalization becomes $(1+e^{-\omega/T_H})^{-1/2}$. The product runs over a discrete basis of outgoing wavepackets labelled by $\omega$ together with angular momentum and species indices; $\omega$ alone is shorthand.)*

Tracing over the interior partner returns *exactly* a thermal state,

$$\rho_{b_\omega} = \operatorname{Tr}_{\tilde b_\omega} |\Psi\rangle\langle\Psi| = \left(1 - e^{-\omega/T_H}\right) \sum_{n=0}^{\infty} e^{-n\omega/T_H} |n\rangle\langle n|,$$

with entropy $S(\rho_{b_\omega}) = (1+\bar n)\ln(1+\bar n) - \bar n \ln \bar n$, where $\bar n = (e^{\omega/T_H} - 1)^{-1}$.

*(Backscattering off the exterior potential barrier introduces greybody factors: the mode that actually reaches infinity is a superposition of the horizon mode and a reflected mode, so its occupation number is $\Gamma_\omega \bar n_\omega$ and it is not exactly thermal at $T_H$. The entanglement structure across the horizon is unaffected, but the entropy per unit emitted energy is — this is the origin of the numerical factor quoted in §3.)*

The essential point: **the exterior radiation is mixed only because its purification sits behind the horizon.** Each emitted quantum adds entropy to the exterior, so $S_{\rm rad}$ grows monotonically, while the black hole's area — and hence $S_{\rm BH} = A/4G$ — shrinks.

### 1.3 Final state: mixed

When evaporation completes, the black hole is gone and the interior partner modes are gone with it. What remains is $\rho_{\rm rad}$, a mixed state with $S_{\rm rad} > 0$.

*(This step assumes evaporation runs to completion and leaves no remnant. Positing a Planck-scale remnant that retains the purification is the standard way of evading it, at the cost of an infinite-species problem: an unbounded number of internal states at bounded mass.)*

### 1.4 The contradiction

Unitary evolution acts as $\rho \to U\rho U^\dagger$. This is a similarity transformation, so it preserves the spectrum of $\rho$ and therefore preserves $S(\rho)$ exactly. A pure state cannot evolve into a mixed one. Hence the process just described cannot be unitary.

That is the paradox, stated precisely: **the semiclassical calculation maps $S = 0$ to $S > 0$, which no unitary can do.**

---

## 2. Why the assumptions cannot all hold

The modern sharpening is due to Almheiri, Marolf, Polchinski and Sully (AMPS). They take the black hole complementarity postulates of Susskind, Thorlacius and Uglum (STU) as given — quoting them rather than modifying them — and show that three of them are mutually inconsistent for a sufficiently old black hole, once one adds a purely quantum-mechanical fact about entanglement.

| | Statement | Content |
|---|---|---|
| **U** | Unitarity (STU 1) | Formation and evaporation, as seen by a distant observer, are described by a unitary $S$-matrix; the final radiation is pure. |
| **E** | Semiclassical exterior (STU 2) | Outside the stretched horizon, physics is well described by semiclassical field equations, and the information is emitted from the near-horizon region. |
| **D** | Level counting (STU 3) | To a distant observer the hole is a quantum system with $\exp(S_{\rm BH})$ states. |
| **S** | Smooth horizon, "no drama" (STU 4) | By the equivalence principle, a freely falling observer encounters the local vacuum at the horizon. |
| **M** | Monogamy | If $B$ and $C$ are jointly in a pure state, $BC$ is uncorrelated with everything else: $\rho_{ABC} = \rho_A \otimes \rho_{BC}$, so $I(A{:}B) = 0$. |

**M** is not an assumption about gravity. It is elementary — a Schmidt decomposition of the pure $\rho_{BC}$ — and strong subadditivity supplies the stable approximate version used in §4. AMPS's claim is that **U**, **E** and **S** are jointly inconsistent; **D** enters only to locate the Page time, and **M** is the theorem that drives the contradiction.

Consider one late Hawking quantum $b$, emitted after the Page time.

**U + E + D force $b$ to be strongly entangled with the early radiation $R$.** Purity of the final state requires $S_{\rm rad}$ to return to zero, so past the turnover each new quantum must *decrease* it. For any separable $\rho_{Rb}$ one has $S(Rb) \ge \max\!\big(S(R), S(b)\big)$ — the entropic separability criterion — so a strict decrease $S(Rb) < S(R)$ already proves that $R$ and $b$ are entangled. The Araki–Lieb inequality $S(Rb) \ge |S(R) - S(b)|$ bounds how fast the entropy can fall, and the maximal decrease $S(Rb) = S(R) - S(b)$ demanded by the descending Page curve is attained only when $b$ is purified by a subsystem of $R$.

**S + E force $\tilde b$ to purify $b$**, i.e. $S(b\tilde b) \approx 0$. "Local vacuum at the horizon" is not an empty statement. The vacuum of a quantum field is precisely the state in which short-wavelength modes straddling the horizon are entangled across it — that entanglement *is* the smoothness.

**M forbids both.** If $\tilde b$ purifies $b$, then $b$ is uncorrelated with $R$.

Exactly one of **U**, **E**, **S** must be abandoned:

- **Drop U.** Hawking's original position: information is genuinely destroyed, the $S$-matrix replaced by a superscattering operator $\$$. Note that $\$$ is still *linear* on density matrices, so linearity is not the objection. The objections are that (i) Banks, Susskind and Peskin showed such evolution generically violates energy–momentum conservation, producing violent heating of ordinary matter, and (ii) — decisively for most workers — AdS/CFT, where the boundary gauge theory evolves manifestly unitarily while describing bulk black hole formation and evaporation.
- **Drop E.** The semiclassical description near or outside the horizon fails, in a way that is subtle, low-energy, and plausibly nonlocal.
- **Drop S.** A *firewall*. The near-horizon vacuum entanglement is broken, and this is not free: the two-point function no longer has its vacuum short-distance form, so $\langle T_{\mu\nu}\rangle$ in the infalling frame is formally UV-divergent, cut off at the Planck scale. Extending the argument to all partial waves — via the mining thought experiment — AMPS conclude the infaller meets a Planck density of Planck-scale quanta and is destroyed at the horizon rather than crossing it unharmed.

Abandoning **M** instead would mean abandoning standard Hilbert-space quantum mechanics. Almost no one takes this route, since **M** is a theorem, not a modelling choice.

---

## 3. The Page curve

Let $S_{\rm rad}(t)$ denote the von Neumann entropy of everything emitted up to time $t$.

**Hawking's answer.** $S_{\rm rad}$ rises monotonically for the entire evaporation, since every quantum is separately thermal and uncorrelated with the rest. Writing $\beta \equiv \dot S_{\rm rad}/(-\dot S_{\rm BH})$ for the coarse-grained entropy the hole emits per unit of Bekenstein–Hawking entropy it loses, the naive quasi-static blackbody estimate gives $\beta = 4/3$ (Zurek). Including greybody factors, Page obtained $\beta \approx 1.4847$ for a nonrotating hole emitting photons and gravitons; the value is species-dependent ($1.5003$ for photons alone, $1.3481$ for gravitons alone, $1.6187$ with three massless neutrino species included). Either way the final radiation entropy exceeds the *initial* $S_{\rm BH}$ by an $\mathcal{O}(1)$ factor and is nonzero — which is the problem.

**Unitarity's answer (Page).** $S_{\rm rad}(t) \lesssim \min\!\left[S^{\rm coarse}_{\rm rad}(t),\, S_{\rm BH}(t)\right]$. The fine-grained entropy is bounded by the coarse-grained entropy of the *smaller* of the two subsystems. Early on the radiation is the smaller system and $S_{\rm rad}$ tracks its own coarse-grained entropy upward; at the **Page time**, defined as the moment the two branches cross, $S_{\rm rad} = S_{\rm BH}$, the curve turns over and thereafter tracks the shrinking $A/4G$ downward, reaching zero when the hole disappears.

With $S^{\rm coarse}_{\rm rad} = \beta\,[S_0 - S_{\rm BH}]$, the crossing occurs at

$$S_{\rm BH} = \frac{\beta}{1+\beta}\,S_0 .$$

For $\beta \approx 1.4847$ this is $S_{\rm BH} \approx 0.5975\,S_0$ — the hole has lost about $40\%$ of its entropy, not half — corresponding to $M \approx 0.773\,M_0$ (since $S_{\rm BH} \propto M^2$) and to about $53.8\%$ of the total evaporation time. The frequently quoted "half the initial entropy", $M \approx M_0/\sqrt{2}$, is the $\beta \to 1$ idealization in which each unit of the hole's entropy loss appears as exactly one unit of coarse-grained radiation entropy.

The turnover is not optional. It is what "the final state is pure" looks like when drawn as a curve, and it is the sharp form of the trouble: **after the Page time, every newly emitted quantum must reduce the radiation's entropy, which means it must already be entangled with what came out before.**

*(The modern derivation — quantum extremal surfaces and "entanglement islands", obtained from replica wormhole saddles of the gravitational path integral — reproduces the descending branch from gravity itself. The island formula*
$$S(R) = \min\,\operatorname{ext}_{I}\left[\frac{\operatorname{Area}(\partial I)}{4G} + S_{\rm semi\text{-}cl}(R \cup I)\right]$$
*extremizes the generalized entropy over the location of the quantum extremal surface $\partial I$ — summing over all components of $\partial I$ — and then minimizes over the extrema. The empty island $I = \varnothing$ is an admissible candidate and reproduces Hawking's rising answer; it is the competition between that saddle and the nontrivial one that produces the turnover. What fails is therefore the naive semiclassical entropy formula — the assumption that $S(R)$ is computed by the exterior effective field theory alone — even where the local state looks perfectly ordinary. This is a failure of **E**, not of the local physics an infaller would measure.)*

---

## 4. The AMPS argument, made explicit

Following Mathur, AMPS convert the tension into a clean contradiction using strong subadditivity (Lieb–Ruskai). Take $A = R$ (early radiation), $B = b$ (the late Hawking mode), $C = \tilde b$ (its interior partner). Strong subadditivity in the form $S(AB) + S(BC) \ge S(B) + S(ABC)$ reads

$$S(Rb) + S(b\tilde b) \;\ge\; S(b) + S(Rb\tilde b).$$

A smooth horizon means $b$ and $\tilde b$ are jointly in a pure state, decoupled from the early radiation. Hence $S(b\tilde b) = 0$ and $S(Rb\tilde b) = S(R)$. Substituting:

$$\boxed{\,S(Rb) \;\ge\; S(R) + S(b)\,}$$

Combined with ordinary subadditivity ($S(Rb) \le S(R) + S(b)$), this forces exact saturation, $\rho_{Rb} = \rho_R \otimes \rho_b$: the new quantum is *uncorrelated* with everything emitted before it. Since $S(b) > 0$ strictly for a thermal mode, the radiation entropy must increase with every emission — Hawking's rising curve, forever. This directly contradicts the Page curve's requirement that $S(Rb) < S(R)$ after the Page time.

In the exact case the conclusion is immediate without any inequality: a pure $\rho_{b\tilde b}$ cannot be correlated with anything. The value of the subadditivity route is that it is *stable*. Relaxing exact smoothness to $S(b\tilde b) \le \epsilon$ gives $I(R{:}b) \le 2\epsilon$, so even a nearly smooth horizon forbids all but $\mathcal{O}(\epsilon)$ correlation with $R$ — the contradiction cannot be evaded by small corrections.

The three roles, plainly:

- **Early radiation $R$.** After the Page time it is large enough to purify the black hole, so it claims the entanglement of each newly emitted quantum.
- **Late mode $b$.** The contested quantum. Both $R$ and $\tilde b$ require its entanglement.
- **Interior partner $\tilde b$.** Smoothness requires it to purify $b$ — but $R$ got there first.

AMPS's "most conservative" conclusion was to keep **U**, **E** and **M** and sacrifice the smooth horizon. The horizon becomes a firewall; and since the interior geometry was only ever assembled out of those partner modes, there may be no interior at all.

---

## 5. Where this stands

Two escape routes are taken seriously.

**ER = EPR (Maldacena–Susskind).** The interior partner $\tilde b$ and the relevant degrees of freedom in $R$ are not independent systems: they are the same degrees of freedom described in two ways, connected by an Einstein–Rosen bridge. Monogamy is then never violated, because $b$ was only ever entangled with one system. The interior is nonlocally encoded in the radiation — black hole complementarity made structural rather than merely asserted.

**Computational censorship (Harlow–Hayden).** Even granting the contradiction in principle, exhibiting it requires an observer to distill $b$'s purifying partner out of the early radiation. Harlow and Hayden argued that this decoding task is computationally hard. Their formal result is conditional: they exhibit states, preparable by polynomial-size circuits, for which an efficient decoder would solve Set Equality and hence place $\mathsf{SZK} \subseteq \mathsf{BQP}$. They conjecture, but do not prove, that decoding a realistic black hole's radiation takes a time exponential in the entropy of the remaining hole; the hole's remaining lifetime after the Page time is by contrast only polynomial in it. Aaronson subsequently weakened the required assumption from $\mathsf{SZK} \not\subset \mathsf{BQP}$ to the existence of injective one-way functions secure against quantum adversaries, and showed that under that assumption even extracting *classical* correlation between $b$ and $R$ is hard. On this view no physical observer can perform the measurement that exposes the paradox.

The island computations are consonant with the first line of resolution. They show that the descending branch of the Page curve follows from the gravitational path integral without any modification to quantum mechanics and without drama at the horizon, because assumption **E**, in its naive local form, is the one that fails: the entropy of distant radiation is not computed by the exterior effective field theory alone. They also place the black hole interior inside the entanglement wedge of the radiation, which is what ER = EPR asserts — though this does not by itself select ER = EPR over other nonlocal-encoding proposals.

What remains open is the mechanism. The island formula appears to be the correct effective answer, and it is derived from the gravitational path integral via replica wormholes; what is missing is a microscopic account of *how* the interior information comes to sit in the radiation, and of what the gravitational path integral's ensemble-like behaviour means for a single black hole.

---

## References

1. S. W. Hawking, "Particle creation by black holes," *Commun. Math. Phys.* **43** (1975) 199; erratum *ibid.* **46** (1976) 206.
2. S. W. Hawking, "Breakdown of predictability in gravitational collapse," *Phys. Rev. D* **14** (1976) 2460.
3. H. Araki and E. H. Lieb, "Entropy inequalities," *Commun. Math. Phys.* **18** (1970) 160.
4. E. H. Lieb and M. B. Ruskai, "A fundamental property of quantum-mechanical entropy," *Phys. Rev. Lett.* **30** (1973) 434; "Proof of the strong subadditivity of quantum-mechanical entropy," *J. Math. Phys.* **14** (1973) 1938.
5. W. H. Zurek, "Entropy evaporated by a black hole," *Phys. Rev. Lett.* **49** (1982) 1683.
6. D. N. Page, "Comment on 'Entropy evaporated by a black hole'," *Phys. Rev. Lett.* **50** (1983) 1013.
7. T. Banks, L. Susskind and M. E. Peskin, "Difficulties for the evolution of pure states into mixed states," *Nucl. Phys. B* **244** (1984) 125.
8. L. Susskind, L. Thorlacius and J. Uglum, "The stretched horizon and black hole complementarity," *Phys. Rev. D* **48** (1993) 3743, arXiv:hep-th/9306069.
9. D. N. Page, "Average entropy of a subsystem," *Phys. Rev. Lett.* **71** (1993) 1291, arXiv:gr-qc/9305007.
10. D. N. Page, "Information in black hole radiation," *Phys. Rev. Lett.* **71** (1993) 3743, arXiv:hep-th/9306083.
11. R. Horodecki, P. Horodecki and M. Horodecki, "Quantum $\alpha$-entropy inequalities: independent condition for local realism?" *Phys. Lett. A* **210** (1996) 377; R. Horodecki and M. Horodecki, "Information-theoretic aspects of inseparability of mixed states," *Phys. Rev. A* **54** (1996) 1838, arXiv:quant-ph/9607007.
12. M. A. Nielsen and J. Kempe, "Separable states are more disordered globally than locally," *Phys. Rev. Lett.* **86** (2001) 5184, arXiv:quant-ph/0011117.
13. S. D. Mathur, "The information paradox: a pedagogical introduction," *Class. Quant. Grav.* **26** (2009) 224001, arXiv:0909.1038.
14. A. Almheiri, D. Marolf, J. Polchinski and J. Sully, "Black holes: complementarity or firewalls?" *JHEP* **02** (2013) 062, arXiv:1207.3123.
15. D. Harlow and P. Hayden, "Quantum computation vs. firewalls," *JHEP* **06** (2013) 085, arXiv:1301.4504.
16. D. N. Page, "Time dependence of Hawking radiation entropy," *JCAP* **09** (2013) 028, arXiv:1301.4995.
17. J. Maldacena and L. Susskind, "Cool horizons for entangled black holes," *Fortsch. Phys.* **61** (2013) 781, arXiv:1306.0533.
18. N. Engelhardt and A. C. Wall, "Quantum extremal surfaces: holographic entanglement entropy beyond the classical regime," *JHEP* **01** (2015) 073, arXiv:1408.3203.
19. S. Aaronson, "The complexity of quantum states and transformations: from quantum money to black holes," arXiv:1607.05256.
20. A. Almheiri, N. Engelhardt, D. Marolf and H. Maxfield, "The entropy of bulk quantum fields and the entanglement wedge of an evaporating black hole," *JHEP* **12** (2019) 063, arXiv:1905.08762.
21. G. Penington, "Entanglement wedge reconstruction and the information paradox," *JHEP* **09** (2020) 002, arXiv:1905.08255.
22. A. Almheiri, T. Hartman, J. Maldacena, E. Shaghoulian and A. Tajdini, "Replica wormholes and the entropy of Hawking radiation," *JHEP* **05** (2020) 013, arXiv:1911.12333.
23. A. Almheiri, T. Hartman, J. Maldacena, E. Shaghoulian and A. Tajdini, "The entropy of Hawking radiation," *Rev. Mod. Phys.* **93** (2021) 035002, arXiv:2006.06872.
24. G. Penington, S. H. Shenker, D. Stanford and Z. Yang, "Replica wormholes and the black hole interior," *JHEP* **03** (2022) 205, arXiv:1911.11977.
