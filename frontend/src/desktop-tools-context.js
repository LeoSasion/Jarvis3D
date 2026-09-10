import { createContext, useContext } from "react";

export const DesktopToolsContext = createContext(null);

export function useDesktopTools() {
  return useContext(DesktopToolsContext);
}
