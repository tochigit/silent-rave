import { auditRoutePolicy, repositoryRoutes } from "./route-policy";
const errors = auditRoutePolicy(await repositoryRoutes());
if (errors.length) throw new Error(errors.join("\n"));
console.log("Protected API methods and page entry points have independent role guards.");
