import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { fitModel } from "../scene/fitModel.ts";

interface Props {
  url: string;
  span: number;
}

const ProjectModel = ({ url, span }: Props) => {
  const { scene } = useLoader(GLTFLoader, url);
  const model = useMemo(() => fitModel(scene, span), [scene, span]);
  return <primitive object={ model } />;
};

export default ProjectModel;
