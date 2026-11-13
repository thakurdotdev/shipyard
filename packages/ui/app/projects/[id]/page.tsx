import ProjectDetails from './project-details';

// Static export: a single shell page (/projects/_) serves every project. Nginx maps
// /projects/<id> to it and the page reads the id from the address bar.
export function generateStaticParams() {
  return [{ id: '_' }];
}

export const dynamicParams = false;

export default function ProjectPage() {
  return <ProjectDetails />;
}
