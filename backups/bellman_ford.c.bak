#define _POSIX_C_SOURCE 200809L

#include "graph.h"

#include <stdio.h>
#include <stdlib.h>
#include <time.h>

static double elapsed_ms(struct timespec start, struct timespec end)
{
    return (end.tv_sec - start.tv_sec) * 1000.0 +
           (end.tv_nsec - start.tv_nsec) / 1000000.0;
}

PathResult bellman_ford(const Graph *g, int src, int dst)
{
    PathResult result = {0};

    struct timespec start, end;
    clock_gettime(CLOCK_MONOTONIC, &start);

    if (!g || !g->vertices ||
        src < 0 || dst < 0 ||
        src >= g->n || dst >= g->n)
    {
        snprintf(result.message, sizeof(result.message),
                 "Invalid source or destination");
        goto finish;
    }

    int n = g->n;

    double *dist = malloc((size_t)n * sizeof(double));
    int *prev = malloc((size_t)n * sizeof(int));

    if (!dist || !prev)
    {
        free(dist);
        free(prev);

        snprintf(result.message, sizeof(result.message),
                 "Memory allocation failed");
        goto finish;
    }

    for (int i = 0; i < n; i++)
    {
        dist[i] = INF;
        prev[i] = -1;
    }

    dist[src] = 0.0;

    /*
     * Relax every directed edge up to n - 1 times.
     * The graph stores outgoing edges in adjacency lists.
     */
    for (int iteration = 0; iteration < n - 1; iteration++)
    {
        int changed = 0;

        for (int u = 0; u < n; u++)
        {
            if (dist[u] == INF)
                continue;

            for (int e = g->vertices[u].head;
                 e != -1;
                 e = g->edges[e].next)
            {

                int v = g->edges[e].to;
                double weight = g->edges[e].weight;
                double candidate = dist[u] + weight;

                if (candidate < dist[v])
                {
                    dist[v] = candidate;
                    prev[v] = u;
                    changed = 1;
                }
            }
        }

        result.explored++;

        if (!changed)
            break;
    }

    if (dist[dst] == INF)
    {
        snprintf(result.message, sizeof(result.message),
                 "No route found between these locations");
        free(dist);
        free(prev);
        goto finish;
    }

    /* Detect a negative cycle reachable from the source. */
    for (int u = 0; u < n; u++)
    {
        if (dist[u] == INF)
            continue;

        for (int e = g->vertices[u].head;
             e != -1;
             e = g->edges[e].next)
        {

            int v = g->edges[e].to;

            if (dist[u] + g->edges[e].weight < dist[v])
            {
                snprintf(result.message, sizeof(result.message),
                         "Reachable negative-weight cycle detected");
                free(dist);
                free(prev);
                goto finish;
            }
        }
    }

    int length = 0;

    for (int v = dst; v != -1; v = prev[v])
    {
        length++;

        if (length > n)
        {
            snprintf(result.message, sizeof(result.message),
                     "Invalid predecessor chain");
            free(dist);
            free(prev);
            goto finish;
        }
    }

    result.vertices = malloc((size_t)length * sizeof(int));

    if (!result.vertices)
    {
        snprintf(result.message, sizeof(result.message),
                 "Path allocation failed");
        free(dist);
        free(prev);
        goto finish;
    }

    result.length = length;
    result.cost = dist[dst];
    result.found = 1;

    int v = dst;

    for (int i = length - 1; i >= 0; i--)
    {
        result.vertices[i] = v;
        v = prev[v];
    }

    snprintf(result.message, sizeof(result.message),
             "Shortest route found");

    free(dist);
    free(prev);

finish:
    clock_gettime(CLOCK_MONOTONIC, &end);
    result.elapsed_ms = elapsed_ms(start, end);

    return result;
}