import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

/** The one reader and writer for the pipeline, so extensions that generators emit are understood. */
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
