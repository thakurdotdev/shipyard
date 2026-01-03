package docker

// Container configuration for running
type ContainerConfig struct {
	ProjectID    string
	BuildID      string
	ImageName    string
	ContainerName string
	HostPort     int
	InternalPort int
	EnvVars      map[string]string
	MemoryLimit  string
	CPULimit     string
	WorkDir      string
}

// Container state info
type ContainerInfo struct {
	ID     string
	Name   string
	Status string // created, running, paused, exited, dead
}

// Image build result
type BuildResult struct {
	Success   bool
	ImageName string
	Error     string
}

// Container run result
type RunResult struct {
	Success     bool
	ContainerID string
	Error       string
}

// Default resource limits
const (
	DefaultMemoryLimit = "512m"
	DefaultCPULimit    = "0.5"
	DefaultInternalPort = 3000
	ViteInternalPort    = 80
)

// Container naming: thakur-{projectId[:8]}
func GetContainerName(projectID string) string {
	if len(projectID) > 8 {
		return "thakur-" + projectID[:8]
	}
	return "thakur-" + projectID
}

// Image naming: thakur-deploy/{projectId[:8]}:{buildId[:8]}
func GetImageName(projectID, buildID string) string {
	pid := projectID
	bid := buildID
	if len(pid) > 8 {
		pid = pid[:8]
	}
	if len(bid) > 8 {
		bid = bid[:8]
	}
	return "thakur-deploy/" + pid + ":" + bid
}
