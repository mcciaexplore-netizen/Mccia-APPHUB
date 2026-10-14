/** The four request states, and the colour each one is shown in: yellow pending, green approved, red rejected, blue more info. */
export const STATUS = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", INFO: "More Info Required" };

export const STATUS_STYLE = {
  [STATUS.PENDING]: "bg-yellow-100 text-yellow-800 border-yellow-300",
  [STATUS.APPROVED]: "bg-green-100 text-green-800 border-green-300",
  [STATUS.REJECTED]: "bg-red-100 text-red-800 border-red-300",
  [STATUS.INFO]: "bg-blue-100 text-blue-800 border-blue-300",
};
