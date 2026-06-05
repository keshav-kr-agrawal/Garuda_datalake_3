export class Tensor {
  // Mock Tensor class
}

export const loadModel = async (path: string) => {
  return {
    run: async (input: any) => new Float32Array(128),
  };
};

export const loadTensorFlowModel = async (path: string) => {
  return {
    mock: true,
    run: async (input: any) => new Float32Array(128),
  };
};

export const loadTensorflowModel = loadTensorFlowModel;

export default {
  Tensor,
  loadModel,
  loadTensorFlowModel,
  loadTensorflowModel,
};

