# OperatorOS UI package

`@operatoros/ui` owns reusable presentation primitives.

The package stores source-owned shadcn components. New components use Base UI.
The current foundation includes `Button`, `Dialog`, and `Input`.

Use Bun commands from the repository root. Add a component with the current
shadcn CLI from `apps/web`, for example:

```sh
bun x --bun shadcn@latest add button -c apps/web
```

Import components through package exports:

```ts
import { Button } from "@operatoros/ui/components/button";
```

The web application owns global tokens. The package does not import API,
database, contract, or application code. Domain components remain in
`apps/web/`. Broad UI redesign belongs to Phase 18.
