#include <pthread.h>
#include <stdio.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

// 获取线程ID (TID)
pid_t gettid()
{
	return syscall(SYS_gettid);
}
pid_t exit_()
{
	return syscall(SYS_exit, 0);
}

int child_pid;

void *thread_function(void *arg)
{
	printf("Worker thread started. My TID is: %d\n", gettid());

	child_pid = gettid();

	sleep(10);
	printf("Worker thread is now exiting.\n");
	return NULL;
}

int main()
{
	pthread_t thread_id;
	pid_t main_tid = gettid();

	printf("Main thread started. My PID/TGID is: %d\n", getpid());
	printf("Main thread TID is: %d\n", main_tid);

	pthread_create(&thread_id, NULL, thread_function, NULL);

	sleep(5);

	int status;
	if (waitpid(child_pid, &status, 0) == -1) {
		perror("waitpid (CLONE_THREAD)");
	}

	return 0;
}
