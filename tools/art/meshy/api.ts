/** The four Meshy task types this pipeline creates, each with its own create and poll path. */
export type TaskKind = 'text-to-image' | 'image-to-3d' | 'rigging' | 'animations';

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

export const TASK_PATH: Record<TaskKind, string> = {
  'text-to-image': '/openapi/v1/text-to-image',
  'image-to-3d': '/openapi/v1/image-to-3d',
  rigging: '/openapi/v1/rigging',
  animations: '/openapi/v1/animations',
};

/** A task as Meshy returns it. Only the fields this pipeline reads are typed. */
export interface MeshyTask {
  id: string;
  status: TaskStatus;
  progress?: number;
  consumed_credits?: number;
  task_error?: { message?: string };
  [field: string]: unknown;
}

/** One entry of the animation library, which is free to list. */
export interface LibraryAction {
  action_id: number;
  name: string;
  key?: string;
  category?: string;
  sub_category?: string;
  preview_url?: string;
}

export interface WaitOptions {
  onProgress?: (percent: number) => void;
}

/** What the pipeline needs from Meshy. The real client and the test fake both implement it. */
export interface MeshyApi {
  balance(): Promise<number>;
  /** Creates a task and returns its id. This is the call that spends credits. */
  create(kind: TaskKind, body: object): Promise<string>;
  /** Polls until the task succeeds. Throws `MeshyTaskError` if it fails, is canceled, or times out. */
  wait(kind: TaskKind, id: string, opts?: WaitOptions): Promise<MeshyTask>;
  /** Saves an asset URL to a file, creating folders. Never sends the API key. */
  download(url: string, destPath: string): Promise<void>;
  library(search?: string): Promise<LibraryAction[]>;
}
