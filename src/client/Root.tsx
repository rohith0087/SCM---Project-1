import { useEffect, useState } from "react";
import App from "./App";
import ExperimentWorkspace from "./ExperimentWorkspace";
export default function Root() {
  const [experiment, setExperiment] = useState(window.location.hash !== "#compare");
  useEffect(() => {
    const change = () => setExperiment(window.location.hash !== "#compare");
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  return experiment ? <ExperimentWorkspace /> : <App />;
}
