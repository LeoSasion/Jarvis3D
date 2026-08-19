import { useEffect, useReducer } from "react";
import {
  agentSessionReducer,
  createAgentSessionModel,
} from "../agent-session-model.js";
import { platform } from "../platform/index.js";

export function observeAgentState(agent, events, onState, onError) {
  let disposed = false;
  let receivedLiveState = false;
  const stopState = events.subscribe("agent.stateChanged", (state) => {
    receivedLiveState = true;
    onState(state);
  });
  const ready = agent.getState()
    .then((state) => {
      if (!disposed && !receivedLiveState) onState(state);
    })
    .catch((error) => {
      if (!disposed && !receivedLiveState) onError(error);
    });

  return {
    ready,
    dispose() {
      disposed = true;
      stopState();
    },
  };
}

export function useAgentState() {
  const [model, dispatch] = useReducer(
    agentSessionReducer,
    undefined,
    () => createAgentSessionModel(),
  );

  useEffect(() => {
    const observer = observeAgentState(
      platform.agent,
      platform.events,
      (state) => dispatch({ type: "state-changed", state }),
      (error) => dispatch({ type: "error", error }),
    );
    return observer.dispose;
  }, []);

  return model.state;
}
