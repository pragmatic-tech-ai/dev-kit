# @pragmatic-tech-ai/todl-runtime

The runtime base for TODL-generated entity classes.

It provides `Observable` — a minimal name/setter `INotifyPropertyChanged`
analog with zero dependency-property overhead. TODL's js-module emitter emits
`class <Concept> extends Observable`, and mural's `MuralBase extends Observable`,
so a generated entity and mural's own visuals share **one** `Observable` class
identity — which is what lets mural's data binding and `DataTemplate` dispatch
treat a realized TODL node as a first-class bindable source.

Zero dependencies by design: neither mural nor the `@pragmatic-tech-ai/todl`
compiler is pulled in.

## Core primitives

This package is the canonical, single source of truth for the zero-dep
primitives the whole stack shares — `Observable`, `PropertyChangedEventArgs`,
`Signal`, `Disposable`, and the `IStorage` storage family. mural re-exports
them from `@pragmatic-tech-ai/mural/runtime` for import convenience, but they
are defined **here** and must never be re-declared downstream.

For the full concept map — these primitives plus the Mural-owned foundation
types (`MuralBase`, `ServiceProvider`, the binding family, …), each with its
defining file and import path — see `Mural/src/runtime/CORE-CONCEPTS.md`.
