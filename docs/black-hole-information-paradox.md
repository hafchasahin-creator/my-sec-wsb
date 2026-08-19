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

where $T_H = \kappa/2\pi$ is the Hawking temperature ($\kappa = 1/4GM$ and $T_H = 1/8\pi G M$ for Schwarzschild). This is the Bogoliubov statement that the in-vacuum is a squeezed state in the out-mode basis; the exponent $e^{-\omega/2T_H}$ is fixed by the analytic structure of the modes across the horizon, not by any thermodynamic input.

Tracing over the interior partner returns *exactly* a thermal state,

$$\rho_{b_\omega} = \operatorname{Tr}_{\tilde b_\omega} |\Psi\rangle\langle\Psi| = \left(1 - e^{-\omega/T_H}\right) \sum_{n=0}^{\infty} e^{-n\omega/T_H} |n\rangle\langle n|,$$

with entropy $S(\rho_{b_\omega}) = (1+\bar n)\ln(1+\bar n) - \bar n \ln \bar n$, where $\bar n = (e^{\omega/T_H} - 1)^{-1}$. (Greybody factors from backscattering off the exterior potential barrier modify the emitted spectrum, but not this entanglement structure.)

The essential point: **the exterior radiation is mixed only because its purification sits behind the horizon.** Each emitted quantum adds entropy to the exterior, so $S_{\rm rad}$ grows monotonically, while the black hole's area — and hence $S_{\rm BH} = A/4G$ — shrinks.

### 1.3 Final state: mixed

When evaporation completes, the black hole is gone and the interior partner modes are gone with it. What remains is $\rho_{\rm rad}$, a mixed state with $S_{\rm rad} > 0$.

### 1.4 The contradiction

Unitary evolution acts as $\rho \to U\rho U^\dagger$. This is a similarity transformation, so it preserves the spectrum of $\rho$ and therefore preserves $S(\rho)$ exactly. A pure state cannot evolve into a mixed one. Hence the process just described cannot be unitary.

That is the paradox, stated precisely: **the semiclassical calculation maps $S = 0$ to $S > 0$, which no unitary can do.**

---

## 2. Why the four assumptions cannot all hold

The modern sharpening, due to Almheiri, Marolf, Polchinski and Sully (AMPS), isolates four claims — a refinement of the black hole complementarity postulates of Susskind, Thorlacius and Uglum — and shows they are mutually inconsistent.

| | Assumption | Content |
|---|---|---|
| **U** | Unitarity | The global state remains pure; information returns in the radiation. |
| **E** | Semiclassical exterior | Effective field theory is valid outside the stretched horizon; Hawking's calculation is reliable there. |
| **S** | Smooth horizon ("no drama") | By the equivalence principle, a freely falling observer encounters the local vacuum at the horizon. |
| **M** | Monogamy of entanglement | A system maximally entangled with one subsystem is in a product state with everything else — a theorem of ordinary quantum mechanics, following from strong subadditivity. |

Consider one late Hawking quantum $b$, emitted after more than half the initial entropy has been radiated.

**U + E force $b$ to be nearly maximally entangled with the early radiation $R$.** Purity of the final state requires $S_{\rm rad}$ to return to zero, so past the halfway point each new quantum must *decrease* it. Subadditivity gives $S(Rb) \le S(R) + S(b)$ with equality precisely when $\rho_{Rb} = \rho_R \otimes \rho_b$; a strict decrease, $S(Rb) < S(R)$, therefore requires substantial $R$–$b$ entanglement.

**S + E force $b$ to be nearly maximally entangled with its interior partner $\tilde b$.** "Local vacuum at the horizon" is not an empty statement. The vacuum of a quantum field is precisely the state in which short-wavelength modes straddling the horizon are entangled across it — that entanglement *is* the smoothness.

**M forbids both.** $b$ cannot be nearly maximally entangled with $R$ and with $\tilde b$ simultaneously.

Exactly one assumption must be abandoned:

- **Drop U.** Hawking's original position: information is genuinely destroyed. This conflicts with the linear, unitary structure of quantum mechanics itself, and — more decisively for most workers — with AdS/CFT, where the boundary gauge theory evolves manifestly unitarily while describing bulk black hole formation and evaporation.
- **Drop E.** The semiclassical description near or outside the horizon fails, in a way that is subtle, low-energy, and plausibly nonlocal.
- **Drop S.** A *firewall*. The near-horizon vacuum entanglement is broken, and breaking short-distance entanglement in a quantum field is not free: the resulting state carries a divergent (cutoff-scale) energy density in the infalling frame. The infaller is destroyed at the horizon rather than crossing it unharmed.
- **Drop M.** Abandon standard Hilbert-space quantum mechanics. Almost no one takes this route, since monogamy is a theorem, not a modeling choice.

---

## 3. The Page curve

Let $S_{\rm rad}(t)$ denote the von Neumann entropy of everything emitted up to time $t$.

**Hawking's answer.** $S_{\rm rad}$ rises monotonically for the entire evaporation, since every quantum is separately thermal and uncorrelated with the rest. The final value exceeds the *initial* Bekenstein–Hawking entropy by an $\mathcal{O}(1)$ factor — $4/3$ in the naive quasi-static blackbody estimate, and $\approx 1.5$ in Page's more careful treatment for a Schwarzschild hole — and it is nonzero, which is the problem.

**Unitarity's answer (Page).** $S_{\rm rad}(t) \lesssim \min\!\left[S^{\rm coarse}_{\rm rad}(t),\, S_{\rm BH}(t)\right]$. The fine-grained entropy is bounded by the *smaller* of the two subsystems' coarse-grained entropies. Early on the radiation is the smaller system and $S_{\rm rad}$ tracks its own thermal entropy upward; at the **Page time** — roughly when the remaining $S_{\rm BH}$ has fallen to half its initial value, i.e. when $M \approx M_0/\sqrt{2}$, since $S_{\rm BH} \propto M^2$ — the curve turns over and thereafter tracks the shrinking $A/4G$ downward, reaching zero when the black hole disappears.

The turnover is not optional. It is what "the final state is pure" looks like when drawn as a curve, and it is the sharp form of the trouble: **after the Page time, every newly emitted quantum must reduce the radiation's entropy, which means it must already be entangled with what came out before.**

*(The modern derivation — quantum extremal surfaces and "entanglement islands", justified by replica wormhole saddles in the gravitational path integral — reproduces the descending branch from gravity itself. The island formula*
$$S(R) = \min\,\operatorname{ext}_{I}\left[\frac{\operatorname{Area}(\partial I)}{4G} + S_{\rm semi-cl}(R \cup I)\right]$$
*shows that what fails is the naive semiclassical entropy formula — the assumption that $S(R)$ is computed by the exterior effective field theory alone — even in regions where the local state looks perfectly ordinary. This is a failure of **E**, not of the local physics an infaller would measure.)*

---

## 4. The AMPS argument, made explicit

AMPS convert the tension into a clean contradiction using strong subadditivity (Lieb–Ruskai). Take $A = R$ (early radiation), $B = b$ (the late Hawking mode), $C = \tilde b$ (its interior partner). Strong subadditivity in the form $S(AB) + S(BC) \ge S(B) + S(ABC)$ reads

$$S(Rb) + S(b\tilde b) \;\ge\; S(b) + S(Rb\tilde b).$$

A smooth horizon means $b$ and $\tilde b$ are in a pure entangled state, decoupled from the early radiation. Hence $S(b\tilde b) = 0$ and $S(Rb\tilde b) = S(R)$. Substituting:

$$\boxed{\,S(Rb) \;\ge\; S(R) + S(b)\,}$$

Combined with ordinary subadditivity ($S(Rb) \le S(R) + S(b)$), this forces exact saturation, $\rho_{Rb} = \rho_R \otimes \rho_b$: the new quantum is *uncorrelated* with everything emitted before it. Since $S(b) > 0$ strictly for a thermal mode, the radiation entropy must increase with every emission — Hawking's rising curve, forever. This directly contradicts the Page curve's requirement that $S(Rb) < S(R)$ after the Page time.

The three roles, plainly:

- **Early radiation $R$.** After the Page time it is large enough to purify the black hole, so it claims the entanglement of each newly emitted quantum.
- **Late mode $b$.** The contested quantum. Both $R$ and $\tilde b$ require its entanglement.
- **Interior partner $\tilde b$.** Smoothness requires it to be entangled with $b$ — but $R$ got there first.

AMPS's "most conservative" conclusion was to keep **U**, **E** and **M** and sacrifice the smooth horizon. The horizon becomes a firewall; and since the interior geometry was only ever assembled out of those partner modes, there may be no interior at all.

---

## 5. Where this stands

Two escape routes are taken seriously.

**ER = EPR (Maldacena–Susskind).** The interior partner $\tilde b$ and the relevant degrees of freedom in $R$ are not independent systems: they are the same degrees of freedom described in two ways, connected by an Einstein–Rosen bridge. Monogamy was then never violated, because $b$ was only ever entangled with one system. The interior is nonlocally encoded in the radiation — a statement of black hole complementarity made structural rather than merely asserted.

**Computational censorship (Harlow–Hayden).** Even granting the contradiction in principle, exhibiting it requires an observer to distill $b$'s purifying partner out of the early radiation. Harlow and Hayden showed this decoding task is computationally hard — the required quantum computation takes a time exponential in the black hole entropy, whereas the hole's remaining lifetime after the Page time is only polynomial in it. (Aaronson later strengthened the result, basing it on the existence of injective one-way functions rather than on a specific construction.) No physical observer can perform the measurement that exposes the paradox.

The island computations lend weight to the first line of resolution. They show that the descending branch of the Page curve follows from the gravitational path integral without any modification to quantum mechanics and without drama at the horizon — the reason being that assumption **E**, in its naive local form, is the one that fails: the entropy of distant radiation is not computed by the exterior effective field theory alone. What remains open is the mechanism — a bulk, microscopic account of *how* the interior information is encoded in the radiation, of which the island formula is currently a correct answer whose derivation from first principles is still being assembled.

---

## References

1. S. W. Hawking, "Particle creation by black holes," *Commun. Math. Phys.* **43** (1975) 199; erratum *ibid.* **46** (1976) 206.
2. S. W. Hawking, "Breakdown of predictability in gravitational collapse," *Phys. Rev. D* **14** (1976) 2460.
3. W. H. Zurek, "Entropy evaporated by a black hole," *Phys. Rev. Lett.* **49** (1982) 1683.
4. D. N. Page, "Comment on 'Entropy evaporated by a black hole'," *Phys. Rev. Lett.* **50** (1983) 1013.
5. E. H. Lieb and M. B. Ruskai, "A fundamental property of quantum-mechanical entropy," *Phys. Rev. Lett.* **30** (1973) 434; "Proof of the strong subadditivity of quantum-mechanical entropy," *J. Math. Phys.* **14** (1973) 1938.
6. L. Susskind, L. Thorlacius and J. Uglum, "The stretched horizon and black hole complementarity," *Phys. Rev. D* **48** (1993) 3743, arXiv:hep-th/9306069.
7. D. N. Page, "Average entropy of a subsystem," *Phys. Rev. Lett.* **71** (1993) 1291, arXiv:gr-qc/9305007.
8. D. N. Page, "Information in black hole radiation," *Phys. Rev. Lett.* **71** (1993) 3743, arXiv:hep-th/9306083.
9. A. Almheiri, D. Marolf, J. Polchinski and J. Sully, "Black holes: complementarity or firewalls?" *JHEP* **02** (2013) 062, arXiv:1207.3123.
10. J. Maldacena and L. Susskind, "Cool horizons for entangled black holes," *Fortsch. Phys.* **61** (2013) 781, arXiv:1306.0533.
11. D. Harlow and P. Hayden, "Quantum computation vs. firewalls," *JHEP* **06** (2013) 085, arXiv:1301.4504.
12. N. Engelhardt and A. C. Wall, "Quantum extremal surfaces: holographic entanglement entropy beyond the classical regime," *JHEP* **01** (2015) 073, arXiv:1408.3203.
13. G. Penington, "Entanglement wedge reconstruction and the information paradox," *JHEP* **09** (2020) 002, arXiv:1905.08255.
14. A. Almheiri, N. Engelhardt, D. Marolf and H. Maxfield, "The entropy of bulk quantum fields and the entanglement wedge of an evaporating black hole," *JHEP* **12** (2019) 063, arXiv:1905.08762.
15. G. Penington, S. H. Shenker, D. Stanford and Z. Yang, "Replica wormholes and the black hole interior," *JHEP* **03** (2022) 205, arXiv:1911.11977.
16. A. Almheiri, T. Hartman, J. Maldacena, E. Shaghoulian and A. Tajdini, "Replica wormholes and the entropy of Hawking radiation," *JHEP* **05** (2020) 013, arXiv:1911.12333.
17. A. Almheiri, T. Hartman, J. Maldacena, E. Shaghoulian and A. Tajdini, "The entropy of Hawking radiation," *Rev. Mod. Phys.* **93** (2021) 035002, arXiv:2006.06872.
18. S. Aaronson, "The complexity of quantum states and transformations: from quantum money to black holes," arXiv:1607.05256.
