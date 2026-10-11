import { createRoot } from "react-dom/client";
import { PlateApp } from "../src/components/plate-app";
import "../src/styles.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<PlateApp />);
