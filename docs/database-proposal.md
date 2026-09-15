# Database proposal

Status: design proposal, not an applied migration.

## Scope and conventions

Use the existing PostgreSQL database and Drizzle schema. Keep the existing
`user`, `session`, `account`, and `verification` authentication tables.

- New entity IDs: `uuid`; references to the existing `user.id`: `text`.
- All household-owned records carry `household_id uuid NOT NULL`.
- Timestamps: `timestamptz`; stock expiration: `date`, interpreted in the household timezone.
- Quantities: `numeric(18,6)`, never floating point. Canonical units: `g`, `ml`, `each`.
- Mutable root records carry `created_at`, `updated_at`, and `version integer`.
- Archive referenced recipes, ingredients, and diners instead of deleting their history.
- Tables below list business columns; IDs and shared columns are omitted where implicit.
- `?` means nullable. References are foreign keys, not embedded object IDs in JSON.

## 1. Household and people

| Table | Business columns | Constraints |
| --- | --- | --- |
| `households` | `name text`, `timezone text` | Supported IANA timezone |
| `household_members` | `user_id text`, `status text`, `joined_at timestamptz` | Unique `(household_id, user_id)`; status `active` or `inactive` |
| `diners` | `member_id uuid?`, `name text`, `archived_at timestamptz?` | Partial unique `(household_id, member_id)` where member is not null |
| `shopping_settings` | `include_planned_meals boolean`, `planning_horizon_days integer` | One row per household; positive horizon |

A diner may have no account. A user may belong to several households, with an
independent diner profile in each. Every active member has the same domain edit
permissions. Membership does not grant access to another user's credentials.

## 2. Food and dietary profiles

| Table | Business columns | Constraints |
| --- | --- | --- |
| `ingredients` | `name text`, `base_unit text`, `archived_at timestamptz?` | Base unit is `g`, `ml`, or `each`; immutable after quantitative references exist |
| `products` | `ingredient_id uuid`, `name text`, `brand text?`, `barcode text?` | A product is a purchasable variant of one stock ingredient |
| `allergens` | `code text`, `name text` | Global reference table; unique code |
| `ingredient_allergens` | `ingredient_id uuid`, `allergen_id uuid`, `status text`, `source text?` | Unique ingredient/allergen; status `contains`, `may_contain`, `absent`, or `unknown` |
| `product_allergens` | `product_id uuid`, `allergen_id uuid`, `status text`, `source text?` | Unique product/allergen; same status set |
| `dietary_restrictions` | `code text`, `name text` | Global supported restriction vocabulary; unique code |
| `ingredient_dietary_compatibility` | `ingredient_id uuid`, `restriction_id uuid`, `status text` | Unique ingredient/restriction; status `compatible`, `incompatible`, or `unknown` |
| `product_dietary_compatibility` | `product_id uuid`, `restriction_id uuid`, `status text`, `source text?` | Unique product/restriction; status `compatible`, `incompatible`, or `unknown` |
| `diner_preferences` | `diner_id uuid`, `ingredient_id uuid`, `preference text` | Unique diner/ingredient; preference `like` or `dislike` |
| `diner_allergies` | `diner_id uuid`, `allergen_id uuid`, `notes text?` | Unique diner/allergen |
| `diner_restrictions` | `diner_id uuid`, `restriction_id uuid`, `notes text?` | Unique diner/restriction |
| `ingredient_unit_conversions` | `ingredient_id uuid`, `input_unit text`, `base_quantity_per_unit numeric(18,6)` | Unique ingredient/input unit; positive factor |

Global vocabulary tables are exceptions to the household ownership convention.
All user-editable food data remains household-owned. The compatibility matrix
supports a small explicit restriction catalog without a configurable rules engine.
Missing declarations mean unknown, not absence. An incompatible declaration must
not be overridden by a generic compatible declaration. Evaluate the actual product
when it is known; an unresolved ingredient/product declaration conflict remains
unknown. Recipe-level results are derived from their ingredients and actual products.

Ingredient-specific conversions support quantities such as cups or individual
pieces without assuming that volume equals mass. Store resolved canonical amounts
on recipe versions and movements, so later conversion edits cannot change history.

## 3. Recipes

| Table | Business columns | Constraints |
| --- | --- | --- |
| `recipes` | `name text`, `archived_at timestamptz?` | Stable recipe identity |
| `recipe_versions` | `recipe_id uuid`, `version_number integer`, `servings numeric(10,3)`, `instructions text`, `published_at timestamptz?` | Unique recipe/version number; positive servings; at most one unpublished draft per recipe; published versions immutable |
| `recipe_ingredients` | `recipe_version_id uuid`, `ingredient_id uuid`, `quantity_base numeric(18,6)`, `position integer` | Positive quantity; unique version/position |

Choose the latest published version for new selections. Plans and preparations
reference a specific published version; reject references to drafts. Editing a published
recipe creates a new version. Publishing and references must be checked transactionally.
Enforce immutability of the published header, publication timestamp, and all ingredient
children, including inserts and deletes, with database triggers. Use a partial unique
index on `(household_id, recipe_id)` where `published_at IS NULL` for the draft.

## 4. Inventory and operations

| Table | Business columns | Constraints |
| --- | --- | --- |
| `domain_operations` | `idempotency_key text`, `kind text`, `actor_member_id uuid`, `request_hash text` | Unique household/idempotency key; reject key reuse with different content |
| `inventory_lots` | `ingredient_id uuid`, `product_id uuid?`, `quantity_on_hand numeric(18,6)`, `expires_on date?` | Nonnegative balance; product must belong to the same ingredient |
| `stock_movements` | `operation_id uuid`, `line_number integer`, `lot_id uuid`, `quantity_delta numeric(18,6)`, `reason text`, `preparation_id uuid?`, `receipt_line_id uuid?`, `reverses_movement_id uuid?`, `occurred_at timestamptz` | Unique operation/line number; nonzero delta; source and sign checks; at most one full reversal per original movement |

Movement reasons: `purchase`, `preparation`, `waste`, `correction`, `reversal`.
Purchases have positive deltas; preparation and waste have negative deltas;
corrections are signed. A reversal has exactly the opposite delta of its original.
Purchase movements require a receipt line; preparation movements require a
preparation. Enforce mutually exclusive source types.

The movement ledger is authoritative. Lot balance is a maintained projection,
updated in the same transaction. Lock affected lots in stable ID order or use a
conditional decrement, and reject the transaction if stock is insufficient.
The sum of movements and the lot balance must reconcile, including the initial
stock entry. Only preparation debits create replacement demand.

Before allocating a preparation, filter lots by expiry, available quantity, and current
dietary compatibility for every participant. Evaluate actual product declarations
alongside ingredient declarations; for unbranded stock, evaluate the ingredient.
`contains`, `may_contain`, or `incompatible` declarations cannot pass the relevant
allergy/restriction check. Missing information and unresolved conflicts remain unknown
and block automatic confirmation until the declarations are resolved. Apply FEFO
(first expiry, first out) only among compatible eligible lots. Record the actual lot
and product evidence in the preparation snapshot. If inventory is inaccurate,
let a member explicitly reconcile the stock before confirming preparation; never
silently invent stock or bypass the nonnegative balance constraint.

## 5. Planned and prepared meals

| Table | Business columns | Constraints |
| --- | --- | --- |
| `meal_plan_entries` | `recipe_version_id uuid`, `scheduled_at timestamptz`, `planned_servings numeric(10,3)`, `cancelled_at timestamptz?` | Positive servings; completion is derived, cancellation is explicit |
| `meal_plan_diners` | `meal_plan_entry_id uuid`, `diner_id uuid` | Unique entry/diner |
| `meal_preparations` | `operation_id uuid`, `recipe_version_id uuid`, `meal_plan_entry_id uuid?`, `servings numeric(10,3)`, `fulfilled_plan_servings numeric(10,3)`, `prepared_at timestamptz`, `dietary_snapshot jsonb`, `reversed_by_operation_id uuid?`, `supersedes_preparation_id uuid?` | One preparation per operation; at most one direct successor per preparation; successor references a reversed preparation; positive servings; fulfilled plan servings between zero and actual servings, zero without a linked plan |
| `meal_preparation_diners` | `preparation_id uuid`, `diner_id uuid` | Unique preparation/diner |

Actual ingredient usage is represented by preparation stock movements, not a
second editable quantity table. Substitutions are expressed by the actual lots used.
One planned meal may have multiple partial preparations. Remaining planned servings
are calculated from its non-reversed preparations; prevent over-fulfillment while
locking the plan row. Unplanned extra servings create no extra plan fulfillment.
Derive display status as `cancelled` when explicitly cancelled, otherwise `completed`
when remaining servings are zero, otherwise `planned`. Reversing a preparation
therefore reopens the outstanding plan automatically unless it is cancelled. Plan
queries and shopping demand use this derivation rather than a stored completed flag.

An overdue plan remains visible until explicitly rescheduled, cancelled, or cooked;
being in the past is not equivalent to being completed. The default shopping horizon
includes overdue outstanding entries and entries through the configured end date.

Revalidate current dietary rules when confirming a preparation. Store the evaluated
participants, current dietary rules, actual consumed lot IDs, product IDs (nullable),
resolved ingredient/product declarations and their sources, quantities, evaluation
version, and outcome in the immutable snapshot. Snapshot values as well as references
so later edits to product metadata do not rewrite the evaluated evidence. This is
historical evidence, not a promise of medical safety.

## 6. Shopping and replacement

| Table | Business columns | Constraints |
| --- | --- | --- |
| `shopping_lists` | `status text`, `opened_at timestamptz`, `closed_at timestamptz?`, `predecessor_list_id uuid?` | At most one open list per household; unique predecessor, preventing duplicate successors |
| `shopping_items` | `list_id uuid`, `ingredient_id uuid`, `manual_extra_quantity numeric(18,6)`, `override_quantity numeric(18,6)?`, `suppressed boolean`, `checked boolean`, `manual_generation integer`, `override_generation integer` | Unique list/ingredient; positive accounting generations; nonnegative quantities |
| `replenishment_demands` | `source_movement_id uuid`, `quantity_base numeric(18,6)`, `cancelled_by_operation_id uuid?` | Unique source movement; positive quantity equal to the original preparation debit magnitude |
| `purchases` | `list_id uuid?`, `store_name text?`, `status text` | Purchase may exist independently of a list |
| `purchase_receipts` | `purchase_id uuid`, `operation_id uuid`, `received_at timestamptz`, `reversed_by_operation_id uuid?` | Unique operation; each receipt is an immutable received batch |
| `purchase_receipt_lines` | `receipt_id uuid`, `ingredient_id uuid`, `product_id uuid?`, `lot_id uuid`, `quantity_base numeric(18,6)` | Positive quantity; line, lot, ingredient, and product agree |
| `replenishment_allocations` | `demand_id uuid`, `receipt_line_id uuid`, `quantity_base numeric(18,6)`, `reversed_by_operation_id uuid?`, `transferred_from_allocation_id uuid?` | Positive quantity; same ingredient; transfer lineage retained; multiple bounded allocation tranches may share demand/receipt line |
| `shopping_item_fulfillments` | `item_id uuid`, `manual_generation integer`, `override_generation integer`, `receipt_line_id uuid`, `total_quantity numeric(18,6)`, `manual_quantity numeric(18,6)`, `override_quantity numeric(18,6)`, `reversed_by_operation_id uuid?` | Unique active item/receipt line; positive total; manual and override credits each between zero and total; same ingredient |

A receipt can fulfill several existing demands; a demand can be fulfilled by several
receipts. Allocate receipts against outstanding demands in creation order, under
locks. Allocated totals cannot exceed either demand quantity or received quantity.
Purchases made before a demand exists do not automatically fulfill that future demand.
The only credit carryover is the bounded predecessor-to-successor correction transfer
defined below; it preserves an existing allocation rather than allocating old purchases
to unrelated new consumption.

Each receipt line creates exactly one purchase stock movement; use a unique index
on purchase `stock_movements.receipt_line_id`. Multiple receipts permit partial
purchases and split expiration lots. A list checkbox alone never creates stock.

Shopping suggestions are derived, not an independently editable stored balance:

```text
replacement_pending = sum(active demand quantities - active allocations)
planning_shortage   = max(0, remaining planned ingredient demand - usable stock)
generated_quantity  = max(replacement_pending, planning_shortage)
displayed_quantity  = override_quantity ?? (generated_quantity + manual_extra_quantity)
```

Compute per ingredient in canonical units. In the formula, manual and override
quantities mean their remaining unfulfilled quantities. Persist receipt fulfillment
separately so a partial purchase reduces them without losing the unmet remainder.
Accounting generations are independent of the mutable row's optimistic-lock `version`:

- Editing manual quantity sets a new remaining manual target and increments only
  `manual_generation`; only manual credits in that generation reduce that target.
- Editing the override sets a new remaining override target and increments only
  `override_generation`; only override credits in that generation reduce that target.
- Changes to checkboxes, suppression, or unrelated fields increment neither accounting
  generation. A manual edit preserves the override target and its existing credits.
- Clearing an override resumes the generated-plus-manual calculation. Overrides are
  total display targets; their credits overlap the attributed generated/manual purchase
  quantities and never represent additional physical receipt capacity.

Process a receipt as one idempotent transaction, serializing by household shopping
state and locking affected plans, demands, items, and lots in stable order. Commands
that change that state use the same locking protocol. Capture generated need and
remaining manual/override targets **before** adding any receipt stock or allocations.
Aggregate all lines for each ingredient and allocate each physical quantity once:

1. Attribute compatible receipt quantities to the pre-receipt generated need first.
   Replacement and planning may overlap: the same quantity can replenish consumption
   and supply a future meal. Use the compatibility/expiry-aware planning allocator
   when stock is not interchangeable. Persist replacement allocations as applicable.
2. Only excess after generated need is eligible for manual credit, capped by remaining
   manual demand. Across all items and receipt lines, generated attribution plus manual
   credit cannot exceed received quantity. In particular, manual credit plus replacement
   allocations cannot exceed receipt capacity. Process batches against the captured
   need, reducing it between lines; do not re-read an already reduced shortage as if
   it were the original need.
3. Record the quantity attributed to an item; cap its total at the larger of its
   pre-receipt generated-plus-manual need and remaining override target. Cap override
   credit itself at the remaining override target (zero when no override is set).
   Across items, total fulfillment
   cannot exceed physical receipt capacity. Manual and override credits refer to the
   same attributed units when applicable; they are not additive stock movements.
   An override changes the displayed target, not whether actual received stock can
   satisfy existing generated demand or eligible manual demand.
4. Add all receipt stock, including quantities beyond any list target. Excess stays
   independent stock, never a negative override remainder or credit for future demands.

Receipt reversal reverses its item credits and replacement allocations too. Credits
from obsolete generations remain history and do not change newer explicit targets.
Closing a list atomically closes it and creates its unique successor, copying each
remaining manual quantity exactly once into a new item with initial generations.
Lock the household/list and make this operation idempotent; concurrent closes cannot
copy twice. Suppression, checked state, and overrides expire with the closed list.

When planning is disabled, its shortage is zero. Allocate stock chronologically by
meal date and expiry, considering participant/product compatibility. The aggregate
formula assumes interchangeable stock that remains usable throughout the horizon;
incompatible product variants must not be pooled to satisfy a participant's meal.
Suppression hides the item for its current list. Show replacement, planning, and
manual contributions as explanations without adding overlapping demands twice.

Replacement demands are independent of list boundaries and survive partial purchases
or list closure. List closure is the explicit shopping-cycle boundary; a separate
cycle table is unnecessary initially. Settings or plan changes update generated
suggestions but preserve the user's override and suppression choices for that list.

## 7. Corrections, isolation, and audit

- Require `UNIQUE (household_id, id)` on referenced household tables and composite
  foreign keys `(household_id, referenced_id)` on their children.
- Product-to-lot and receipt-to-lot references also enforce ingredient consistency.
- Membership checks belong in every server-side command and query. Composite foreign
  keys prevent cross-household links but do not themselves authorize access.
- Use `ON DELETE RESTRICT` for business history. Deactivate membership instead of
  deleting it so historical actor references remain valid.
- Add `audit_events(household_id, operation_id?, actor_member_id, entity_type,
  entity_id, action, before_data jsonb, after_data jsonb, occurred_at)` for shared edits,
  especially dietary restrictions. Audit payloads never contain auth secrets.
- Cross-row invariants require transactional command handlers and, where appropriate,
  deferred constraint triggers; do not pretend a row-level `CHECK` verifies aggregates.
- A correction fully reverses the predecessor preparation's movements and deactivates
  its demands, then creates the corrected preparation with `supersedes_preparation_id`.
  Lock the linked plan and affected demands, receipt lines, allocations, and lots.
  Preserve purchase credit in the same transaction: deactivate predecessor allocations
  and transfer eligible freed credit only to the corrected preparation's same-ingredient
  demands. Eligibility includes freed allocations from its direct predecessor and
  unallocated ancestral credit within the explicit `supersedes_preparation_id` chain.
  Bound transfers by corrected demand capacity, original credit in that lineage, and
  currently free receipt capacity. Set `transferred_from_allocation_id` to the source
  allocation on each new tranche, including when reclaiming ancestral surplus.
  Track each original allocation as a credit root: parent and transferred descendants
  represent the same capacity, so never sum them as new credit. Active descendants
  across the entire chain cannot exceed that root's original quantity; all receipt
  allocations together still cannot exceed its received quantity. Reversed receipts
  provide no transferable credit. Surplus stays unallocated but remains identifiable
  for a later correction in this chain; never scan unrelated historical receipts or
  use this surplus to fund arbitrary later consumption.
  Received goods remain in stock; changing replacement allocations does not receive
  goods again or re-credit shopping items. A reversal without a successor has no transfer.
- Use the correction operation links on preparations, receipts, demands, allocations,
  and item fulfillments to retain their original history. Disallow partial reversals
  initially. Changes to correction markers belong to the same reversal transaction.
- Receipt reversal must also undo its allocations and stock credits atomically,
  including active allocations transferred through any preparation correction lineage;
  reject it when dependent consumption makes the reversal produce negative stock.
- Recheck recipes and plans against current dietary rules; a historical snapshot never
  overrides a newly edited allergy or restriction.

## Indexes and implementation sequence

Important indexes, in addition to PKs and uniqueness constraints:

- Active membership lookup: `(user_id, household_id)`.
- Eligible stock: `(household_id, ingredient_id, expires_on)` for positive balances.
- Movement history: `(household_id, lot_id, occurred_at)`.
- Planned meals: `(household_id, scheduled_at)` for non-cancelled entries; filter
  derived remaining servings when selecting outstanding meals.
- Recipe ingredients: `(household_id, ingredient_id, recipe_version_id)`.
- Demands and receipt allocations: indexes on both foreign-key directions.
- Child foreign keys used in joins or delete/update checks.

Implement in migrations: household and profiles; food and recipes; inventory and
preparations; planning and shopping. Keep one PostgreSQL database and one application.
No queue, microservice split, or general event-sourcing framework is required.

Before enabling writes, verify tenant isolation, simultaneous stock debits, idempotent
receipt handling, partial plan fulfillment, partial purchases, reversal accounting,
unit conversions, and expiry-aware shopping with concrete integration scenarios.

## Acceptance scenarios for implementation

These are required transaction-level examples, not executed SQL tests:

- **Generated-first accounting:** planning shortage 400 g, manual extra 300 g, no
  replacement pending. Receive 300 g of usable stock: generated need becomes 100 g,
  manual extra remains 300 g, and the list shows 400 g. Splitting that receipt into
  several lines in one batch gives the same result.
- **Independent targets:** override 500 g, then receipt 300 g leaves override 200 g.
  Editing manual extra or toggling checked/suppressed preserves that 200 g. A receipt
  above the target credits at most the remaining target; the excess remains stock.
- **Plan reversal:** a four-serving plan is fulfilled by a four-serving preparation.
  Reversing it restores four remaining servings and shopping demand; a cancelled plan
  stays cancelled. A retry does not reverse stock twice.
- **Correction credit:** consume 2 kg, receive and allocate 2 kg, then correct that
  preparation to 1 kg. Transfer 1 kg of predecessor credit; replacement pending stays
  zero. Reversing the receipt deactivates that transferred credit and restores 1 kg
  pending, provided the stock debit can complete without a negative balance.
- **Correction chain:** consume 2 kg and receive/allocate 2 kg, then correct to 1 kg
  and subsequently to 2 kg. Reclaim the lineage's 1 kg ancestral surplus alongside
  the direct predecessor's 1 kg credit: replacement pending remains zero. The original
  2 kg allocation and its transferred descendants count as 2 kg capacity, never 3 kg
  or 4 kg. A reversed receipt cannot supply that credit.
- **List rollover:** close a list with 200 g manual demand remaining. Its successor
  has exactly 200 g manual demand; retrying or concurrently closing creates no duplicate.
- **Compatible preparation:** an earlier-expiring incompatible product is excluded in
  favor of a compatible lot. Unknown declarations prevent automatic confirmation;
  the stored snapshot identifies the consumed lots/products and evaluated metadata.
