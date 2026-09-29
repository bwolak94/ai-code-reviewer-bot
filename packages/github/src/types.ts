export interface InstallationTokenCache {
  token: string;
  expiresAt: Date;
}

export interface CreateCheckRunParams {
  installationId: number;
  owner: string;
  repo: string;
  headSha: string;
  name: string;
}

export interface UpdateCheckRunParams {
  installationId: number;
  owner: string;
  repo: string;
  checkRunId: number;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled';
  output?: CheckRunOutput;
}

export interface CheckRunOutput {
  title: string;
  summary: string;
  annotations?: CheckRunAnnotation[];
}

export interface CheckRunAnnotation {
  path: string;
  startLine: number;
  endLine: number;
  annotationLevel: 'notice' | 'warning' | 'failure';
  message: string;
  title?: string;
}
