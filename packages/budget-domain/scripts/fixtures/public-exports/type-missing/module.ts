export interface RequiredType {
  readonly value: string;
}

interface IntentionallyPrivateType {
  readonly hidden: true;
}

const intentionallyPrivateFixture: IntentionallyPrivateType = { hidden: true };
void intentionallyPrivateFixture;
