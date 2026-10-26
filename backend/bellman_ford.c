#define _POSIX_C_SOURCE 200809L
#include "graph.h"
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <time.h>
static double elapsed_ms(struct timespec start, struct timespec end)
{
    return (end.tv_sec - start.tv_sec) * 1000.0 +
           (end.tv_nsec - start.tv_nsec) / 1000000.0;
}
static int valid_vertex(const Graph *g, int v)
{
    return g != NULL && v >= 0 && v < g->n;
}
static void set_message(PathResult *result, const char *message)
{
    snprintf(result->message, sizeof(result->message), "%s", message);
}
PathResult bellman_ford(const Graph *g, int src, int dst)
{
    PathResult result = {0};
    struct timespec start, end;
    clock_gettime(CLOCK_MONOTONIC, &start);
    double *dist = NULL;
    int *prev = NULL;
    unsigned char *examined = NULL;
    if (!g || !g->vertices || g->n <= 0 ||
        !valid_vertex(g, src) || !valid_vertex(g, dst))
    {
        set_message(&result, "Invalid graph, source, or destination");
        goto finish;
    }
    int n = g->n;
    dist = malloc((size_t)n * sizeof(*dist));
    prev = malloc((size_t)n * sizeof(*prev));
    examined = calloc((size_t)n, sizeof(*examined));
    if (!dist || !prev || !examined)
    {
        set_message(&result, "Memory allocation failed");
        goto cleanup;
    }
    for (int i = 0; i < n; i++)
    {
        dist[i] = INF;
        prev[i] = -1;
    }
    dist[src] = 0.0;
    /*
     * Bellman-Ford performs at most n - 1 relaxation passes.
     *
     * Metrics:
     * explored:
     *   Number of distinct reachable vertices whose outgoing
     *   adjacency lists were examined.
     *
     * edge_examinations:
     *   Number of edges inspected during relaxation and the
     *   negative-cycle detection check.
     *
     * successful_relaxations:
     *   Number of successful distance updates during relaxation.
     *
     * relaxation_passes:
     *   Number of passes actually started.
     */
    for (int iteration = 0; iteration < n - 1; iteration++)
    {
        int changed = 0;
        result.relaxation_passes++;
        for (int u = 0; u < n; u++)
        {
            if (dist[u] == INF)
                continue;
            if (!examined[u])
            {
                examined[u] = 1;
                result.explored++;
            }
            for (int e = g->vertices[u].head;
                 e != -1;
                 e = g->edges[e].next)
            {
                result.edge_examinations++;
                int v = g->edges[e].to;
                double weight = g->edges[e].weight;
                if (!valid_vertex(g, v) || !isfinite(weight))
                {
                    set_message(&result, "Invalid edge endpoint or weight");
                    goto cleanup;
                }
                double candidate = dist[u] + weight;
                if (!isfinite(candidate))
                {
                    set_message(&result, "Distance overflow detected");
                    goto cleanup;
                }
                if (candidate < dist[v])
                {
                    dist[v] = candidate;
                    prev[v] = u;
                    result.successful_relaxations++;
                    changed = 1;
                }
            }
        }
        /* Stop early when no distances change. */
        if (!changed)
            break;
    }
    /*
     * Detect negative-weight cycles reachable from the source.
     * This check also contributes to edge_examinations.
     */
    for (int u = 0; u < n; u++)
    {
        if (dist[u] == INF)
            continue;
        for (int e = g->vertices[u].head;
             e != -1;
             e = g->edges[e].next)
        {
            result.edge_examinations++;
            int v = g->edges[e].to;
            double weight = g->edges[e].weight;
            if (!valid_vertex(g, v) || !isfinite(weight))
            {
                set_message(&result, "Invalid edge endpoint or weight");
                goto cleanup;
            }
            if (dist[u] + weight < dist[v])
            {
                set_message(
                    &result,
                    "Reachable negative-weight cycle detected");
                goto cleanup;
            }
        }
    }
    if (dist[dst] == INF)
    {
        set_message(&result, "No route found between these locations");
        goto cleanup;
    }
    /*
     * Reconstruct the route from destination to source.
     */
    int length = 0;
    int current = dst;
    while (current != -1)
    {
        if (!valid_vertex(g, current) || length >= n)
        {
            set_message(&result, "Invalid predecessor chain");
            goto cleanup;
        }
        length++;
        if (current == src)
            break;
        current = prev[current];
    }
    if (current != src)
    {
        set_message(&result, "Could not reconstruct route");
        goto cleanup;
    }
    result.vertices = malloc((size_t)length * sizeof(*result.vertices));
    if (!result.vertices)
    {
        set_message(&result, "Path allocation failed");
        goto cleanup;
    }
    result.length = length;
    result.cost = dist[dst];
    current = dst;
    for (int i = length - 1; i >= 0; i--)
    {
        result.vertices[i] = current;
        if (i > 0)
            current = prev[current];
    }
    result.found = 1;
    set_message(&result, "Shortest route found");
cleanup:
    free(dist);
    free(prev);
    free(examined);
finish:
    clock_gettime(CLOCK_MONOTONIC, &end);
    result.elapsed_ms = elapsed_ms(start, end);
    return result;
}