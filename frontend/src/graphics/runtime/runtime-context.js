import { createContext, useContext } from "react";

export const GraphicsRuntimeContext = createContext(null);

export function useGraphicsRuntimeContext() {
  return useContext(GraphicsRuntimeContext);
}
