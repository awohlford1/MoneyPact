export interface RecordRef {
  recordType: string;
  recordId: string;
  revision?: number;
}

export interface ArtifactRef extends RecordRef {
  digest?: string;
}
