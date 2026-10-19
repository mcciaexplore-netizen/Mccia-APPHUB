/** A red outline badge, shown on a request that is over budget (or has no budget) in every list and on its page. */
export function OverBudgetBadge() {
  return <span className="badge badge-over" title="The amount is more than the budget left (the budget allocated minus the budget used, as the requester typed them)">Over budget</span>;
}
