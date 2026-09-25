# Setting-backed dependency properties — subscription lifetime

A dependency property can source its value from an application setting: pass
`{ key, convert? }` as the trailing registration argument, and the property
resolves through a `PropertyValueSource.SettingValue` tier that sits between
`Inherited` and `Default`. See [property-system.md](property-system.md) for the
value-precedence model and the registration API; this doc is only about how the
*subscription* to the setting is created and — the point of the doc — released.

## The problem: a subscription that roots its owner

To react to a setting change, an `EffectiveValueDescriptor` (EVD) subscribes to
the setting source's change signal:

```
ApplicationSettings → Setting.PropertyChanged signal → callback → EVD → owner
```

The signal lives on `ApplicationSettings`, which lives for the life of the
application. The callback closes over the EVD, which holds its `owner`
(a `MuralBase`, often a `Visual` rooting a whole subtree). So an EVD that
subscribes and is never explicitly torn down pins its owner — and everything the
owner references — in memory for the life of the app. This is not merely a
subscription leak; it roots the owner's entire object graph.

This is the *same* lifetime that any `Binding` to a long-lived external
`Observable` has: mural relies on deterministic teardown (`ClearValue` /
`remove_via_descriptor` → `teardown()`), never on GC finalization, for every
external subscription. A naive eager "subscribe on first read, release only on
remove" makes setting-backed DPs leak exactly like those bindings on any owner
that is dropped rather than explicitly cleared (arch nodes churned as the model
edits, for instance).

## The design: demand-driven subscription (chosen)

The setting subscription exists for **one** reason — to re-emit `PropertyChanged`
(and drive the internal invalidation/inheritance callback) when the setting
changes *and* this EVD is at the `SettingValue` tier. If nothing observes the
property, holding the subscription buys nothing. So the subscription's lifetime
is bound to observer demand:

> **Setting subscription active ⟺ the descriptor is setting-backed ∧ the EVD's
> `changed` signal has ≥ 1 subscriber.**

`Signal` carries optional demand hooks (`SignalLifecycle` in
`todl-runtime/src/signal.ts`): `onFirstSubscriber` fires on the 0 → 1
subscriber transition, `onLastUnsubscribe` on the 1 → 0 transition. The EVD
constructs its `changed` signal with these hooks:

- **First listener** → open the setting subscription (if the ambient
  `ISettingSource` is resolvable now).
- **Last listener leaves** → dispose the setting subscription.

The read path (`resolveSettingValue`) is otherwise pure — it no longer
subscribes on its own. Its one concession is a *guarded retry*: if the property
is already observed but has no live subscription (the `ISettingSource` was not
resolvable when the first listener attached — an ambient-scope race), a read
re-attempts the subscription. `teardown()` remains the hard release for EVD
removal and is idempotent with the demand path.

### Why this closes the leak

The only ways an EVD comes to exist are: **subscribe** or **bind** (both carry an
external `changed` listener), or **set / animate / trigger / style** (all of which
put the source *above* `SettingValue`, so a setting change is masked and
`onSettingChanged` no-ops anyway). Therefore every EVD that can actually sit at
the `SettingValue` tier *and* has a consumer has a `changed` listener — and that
listener's disposal (which a well-behaved owner does at teardown) releases the
setting subscription. What remains is the framework's *pre-existing* "listener
never disposed" responsibility, no worse than any other subscription.

In the first production use — `Diagram.DefaultIconWidth/Height` bound from arch
node icon templates via `$Self.(Diagram.DefaultIconWidth)` — each visible node's
binding is that `changed` listener, so the node subscribes to the setting
directly, reacts, and releases when the node (and its binding) is torn down.

### Accepted limitation

A setting-backed property with **no** active observer will not *proactively*
re-render on a setting change; it pulls the fresh value on the next read. This
only affects a `Visual` that was set/styled and then cleared and is now watched
by nobody — every real consumer (a binding, a view-model listener) is an
observer. Accepted as consistent with the demand-driven premise.

## Rejected alternative: weak subscription + FinalizationRegistry (Option C)

The subscription could instead be held **weakly**: the setting signal keeps a
`WeakRef` to the EVD, a `FinalizationRegistry` disposes the subscription when the
owner is garbage-collected, and `emit` self-prunes dead refs. This is the classic
weak-event pattern and would catch even an owner abandoned *with* a live listener
still attached — the one case the demand-driven model leaves to the caller.

It was rejected because:

- It introduces a weak-event concept nothing else in mural uses; the rest of the
  framework manages every external subscription by deterministic teardown, and a
  second, GC-driven cleanup model fragments that contract.
- Finalization timing is non-deterministic, which makes the behavior hard to test
  and reason about.
- The residual leak it uniquely fixes (abandoned owner *with* an undisposed
  listener) is already the framework's universal "undisposed listener"
  responsibility — not specific to setting-backed DPs.

If mural ever adopts finalization-based cleanup framework-wide, revisit this: the
weak-subscription hook would layer cleanly on top of the demand-driven model
(demand handles the common case cheaply; finalization becomes the backstop).

## Where the code lives

- `todl-runtime/src/signal.ts` — `Signal` demand hooks (`SignalLifecycle`).
- `Mural/src/runtime/binding/effective-value.ts` — `changed` signal wired with
  the hooks; `ensureSettingSubscriptionFromDemand` / `releaseSettingSubscription`
  / guarded retry in `resolveSettingValue`; `teardown()`.
- Tests: `Mural/src/runtime/binding/tests/setting-value-reactivity.test.ts`
  (demand-driven lifetime + teardown), `todl-runtime/src/tests/signal.test.ts`
  (hook transitions).
