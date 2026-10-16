# Approval System: the rules as built

Who approves what is data (Approver Rules screen, table `apr_approver_rules`); the rules below are what the code does with it.

## Routing

| Request | Step 1 | Step 2 |
|---|---|---|
| HR (every category) | HR reviewer (one named person) | Director General |
| Expenditure of the threshold (₹10,000) **and above** | First approver | Director General |
| Expense below the threshold | First approver | none |

- Exactly the threshold counts as "and above" (goes to the DG). The threshold is the Approvals setting (default ₹10,000).
- The first approver (and the HR reviewer) must be a different person from the Director General. Approver Rules refuses to name one person as a first approver in one place and as the DG in another, or on two steps of one kind of request. Routing also refuses a request whose steps would name the same person twice.
- Nobody approves their own request. When the first approver raises a request, his step is dropped and the Director General decides it, for any amount.
- A request keeps the steps it was given when it was submitted: later rule changes do not alter it.

## Who the approvers are

HR (step 1 of HR), Expenditure (step 1 of expenses, both sizes) and the Super Admin (step 2 of HR and of expenditure of ₹10,000 and above, and sees every request) are main accounts set in the environment (see `docs/ROLES.md`). The first time all three are set, the Approver Rules with nobody named are filled from them, once. After that the Support Admin decides everything on the Approver Rules screen.

## Decisions

| Action | Needs a comment | What happens |
|---|---|---|
| Approve | only when over budget | Moves to the next step, or the request is approved |
| Return for corrections | always | Status **Returned**; the requester is told; the request keeps its step and approver |
| Reject | always | Rejected at once; later steps are marked not needed |

- The requester opens **Edit and resubmit** (from the request page or the notification), changes the form (values and files) and resubmits. It goes back to the approver who returned it, at the same step, with the same request number. Approvals already given are kept. The history shows every round.
- Only the person who raised the request can edit it, and only while it is Returned. The date of request stays as it was. An expenditure amount cannot move across the threshold while editing (that needs a new request through the other form). A returned request can still be withdrawn.
- A returned request is waiting for nobody and uses no budget until it is resubmitted.
- A pending request whose approver is away stays with that approver (it shows in their notifications). There is no reassign.

## Budgets

- An expenditure, and an HR request that carries an amount, are checked against the budget of their branch and category. Approved requests use the budget; pending ones are shown for information.
- Over budget is flagged, never blocked: the approver must write a comment to approve it.
- An HR amount needs a branch and an expense category. Without an amount no budget is attached.

## Putting it live (order matters)

1. Run `scripts/apply-0009-in-neon-console.sql` in the Neon SQL editor (additive: new status values and five empty columns).
2. Deploy the code. (The HR pages read the new columns, so the code must not go first.)
