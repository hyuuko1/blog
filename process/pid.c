#define _GNU_SOURCE
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>
#include <sys/mount.h>

int child_func(void *arg)
{
	printf("--> Inside new PID Namespace:\n");
	/* 注意！ppid 是 0！ */
	printf("    My PID is %d, my PPID is %d\n", getpid(), getppid());

	// mount("proc", "/proc", "proc", 0, NULL);

	// 启动一个新的 shell，以便我们交互式地查看
	execlp("bash", "bash", NULL);
	return 0; // 不会执行到这里
}

int main()
{
	char *stack = malloc(1024 * 1024); // 为子进程分配栈
	if (!stack)
		return 1;
	char *stack_top = stack + (1024 * 1024);

	printf("--> Outside, before clone:\n");
	printf("    My PID is %d\n", getpid());

	// 使用 CLONE_NEWPID 创建新进程和新 PID Namespace
	pid_t pid = clone(child_func, stack_top, CLONE_NEWPID | SIGCHLD, NULL);
	if (pid == -1) {
		perror("clone");
		return 1;
	}

	waitpid(pid, NULL, 0);
	printf("--> Child terminated.\n");
	free(stack);
	return 0;
}
