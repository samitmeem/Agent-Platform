import type {
  ModelProvider,
  ProviderKind,
  ProviderSnapshot,
} from "./base";

export function chooseResolvedProvider(
  snapshots: ProviderSnapshot[],
  preferredKind: ProviderKind,
): ProviderSnapshot | undefined {
  const preferred = snapshots.find(
    (snapshot) => snapshot.kind === preferredKind && snapshot.availability.status === "available",
  );
  if (preferred) {
    return preferred;
  }

  return snapshots.find((snapshot) => snapshot.availability.status === "available");
}

export class ModelProviderRegistry {
  private readonly providers = new Map<ProviderKind, ModelProvider>();

  public constructor(
    providers: ModelProvider[],
    private readonly preferredKind: ProviderKind,
  ) {
    for (const provider of providers) {
      this.providers.set(provider.kind, provider);
    }
  }

  public getPreferredKind(): ProviderKind {
    return this.preferredKind;
  }

  public list(): ModelProvider[] {
    return [...this.providers.values()];
  }

  public async snapshots(): Promise<ProviderSnapshot[]> {
    const snapshots: ProviderSnapshot[] = [];
    for (const provider of this.providers.values()) {
      snapshots.push({
        kind: provider.kind,
        displayName: provider.displayName,
        preferred: provider.kind === this.preferredKind,
        availability: await provider.availability(),
      });
    }

    return snapshots;
  }

  public async resolvePreferredProvider(): Promise<ModelProvider | undefined> {
    const snapshots = await this.snapshots();
    const chosen = chooseResolvedProvider(snapshots, this.preferredKind);
    return chosen ? this.providers.get(chosen.kind) : undefined;
  }
}