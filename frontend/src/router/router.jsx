import { createBrowserRouter } from "react-router-dom";
import HomePage from "../pages/HomePage";
import TagsPage from "../pages/TagsPage";
import PromptsPage from "../pages/PromptsPage";

const router = createBrowserRouter([
  {
    path: "/",
    element: <HomePage />,
  },
  {
    path: "/tags",
    element: <TagsPage />,
  },
  {
    path: "/prompts",
    element: <PromptsPage />,
  },
]);

export default router;
