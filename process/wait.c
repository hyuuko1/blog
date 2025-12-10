#define _GNU_SOURCE
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>

int child_fn(void *arg)
{
	printf("Child thread (pid=%d, tgid=%d) exiting\n", getpid(),
	       (int)gettid());
	return 42;
}

int main()
{
	char stack[1024 * 1024];
	pid_t tid;

	// Case 1: without CLONE_THREAD → waitable
	tid = clone(child_fn, stack + sizeof(stack), CLONE_VM | SIGCHLD, NULL);
	if (tid > 0) {
		int status;
		waitpid(tid, &status, 0);
		printf("Waited child %d, exit code: %d\n", tid,
		       WEXITSTATUS(status));
	}

	// Case 2: with CLONE_THREAD → NOT waitable
	tid = clone(child_fn, stack + sizeof(stack),
		    CLONE_VM | CLONE_THREAD | CLONE_SIGHAND | SIGCHLD, NULL);
	if (tid > 0) {
		// This waitpid will fail (ECHILD)
		int status;
		if (waitpid(tid, &status, 0) == -1) {
			perror("waitpid (CLONE_THREAD)");
		}
	}
	return 0;
}