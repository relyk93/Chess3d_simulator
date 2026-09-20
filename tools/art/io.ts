import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

/**
 * The one reader and writer for the pipeline, so extensions that generators emit are understood.
 * Documents it reads inherit its logger, which is set to warnings only: the library's per-step
 * progress lines would print a dozen times over during a whole-set build.
 */
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.WARN));
