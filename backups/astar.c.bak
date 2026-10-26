#define _POSIX_C_SOURCE 200809L

#include "graph.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>

typedef struct
{
    int vertex;
    double priority;
} HeapNode;

typedef struct
{
    HeapNode *items;
    int size;
    int capacity;
} MinHeap;

static double elapsed_ms(struct timespec start, struct timespec end)
{
    return (end.tv_sec - start.tv_sec) * 1000.0 +
           (end.tv_nsec - start.tv_nsec) / 1000000.0;
}

static int heap_push(MinHeap *heap, int vertex, double priority)
{
    if (heap->size >= heap->capacity)
    {
        int capacity = heap->capacity ? heap->capacity * 2 : 1024;

        HeapNode *items = realloc(
            heap->items,
            (size_t)capacity * sizeof(HeapNode));

        if (!items)
            return 0;

        heap->items = items;
        heap->capacity = capacity;
    }

    int i = heap->size++;

    while (i > 0)
    {
        int parent = (i - 1) / 2;

        if (heap->items[parent].priority <= priority)
            break;

        heap->items[i] = heap->items[parent];
        i = parent;
    }

    heap->items[i].vertex = vertex;
    heap->items[i].priority = priority;

    return 1;
}

static HeapNode heap_pop(MinHeap *heap)
{
    HeapNode result = heap->items[0];
    HeapNode last = heap->items[--heap->size];

    int i = 0;

    while (1)
    {
        int left = 2 * i + 1;
        int right = left + 1;
        int smallest = i;

        if (left < heap->size &&
            heap->items[left].priority < last.priority)
        {
            smallest = left;
        }

        if (right < heap->size)
        {
            double current_smallest =
                smallest == i
                    ? last.priority
                    : heap->items[smallest].priority;

            if (heap->items[right].priority < current_smallest)
            {
                smallest = right;
            }
        }

        if (smallest == i)
            break;

        heap->items[i] = heap->items[smallest];
        i = smallest;
    }

    if (heap->size > 0)
        heap->items[i] = last;

    return result;
}

/* Haversine distance between two geographic coordinates, in metres. */
static double haversine_m(
    double lat1,
    double lon1,
    double lat2,
    double lon2)
{
    const double earth_radius = 6371000.0;
    const double radians = M_PI / 180.0;

    double p1 = lat1 * radians;
    double p2 = lat2 * radians;

    double dp = (lat2 - lat1) * radians;
    double dl = (lon2 - lon1) * radians;

    double a = sin(dp / 2.0) * sin(dp / 2.0) +
               cos(p1) * cos(p2) *
                   sin(dl / 2.0) * sin(dl / 2.0);

    if (a < 0.0)
        a = 0.0;
    if (a > 1.0)
        a = 1.0;

    return 2.0 * earth_radius * asin(sqrt(a));
}

PathResult astar(const Graph *g, int src, int dst)
{
    PathResult result = {0};

    struct timespec start, end;
    clock_gettime(CLOCK_MONOTONIC, &start);

    if (!g || !g->vertices || src < 0 || dst < 0 ||
        src >= g->n || dst >= g->n)
    {
        snprintf(result.message, sizeof(result.message),
                 "Invalid source or destination");
        return result;
    }

    int n = g->n;

    double *dist = malloc((size_t)n * sizeof(double));
    int *prev = malloc((size_t)n * sizeof(int));
    unsigned char *closed = calloc((size_t)n, 1);

    if (!dist || !prev || !closed)
    {
        free(dist);
        free(prev);
        free(closed);

        snprintf(result.message, sizeof(result.message),
                 "Memory allocation failed");
        return result;
    }

    for (int i = 0; i < n; i++)
    {
        dist[i] = INF;
        prev[i] = -1;
    }

    MinHeap heap = {0};

    dist[src] = 0.0;

    double initial_h = haversine_m(
        g->vertices[src].lat,
        g->vertices[src].lon,
        g->vertices[dst].lat,
        g->vertices[dst].lon);

    if (!heap_push(&heap, src, initial_h))
    {
        snprintf(result.message, sizeof(result.message),
                 "Priority queue allocation failed");
        goto cleanup;
    }

    while (heap.size > 0)
    {
        HeapNode current = heap_pop(&heap);
        int u = current.vertex;

        if (closed[u])
            continue;

        closed[u] = 1;
        result.explored++;

        if (u == dst)
            break;

        for (int e = g->vertices[u].head; e != -1;
             e = g->edges[e].next)
        {

            int v = g->edges[e].to;
            double candidate = dist[u] + g->edges[e].weight;

            if (candidate < dist[v])
            {
                dist[v] = candidate;
                prev[v] = u;

                double h = haversine_m(
                    g->vertices[v].lat,
                    g->vertices[v].lon,
                    g->vertices[dst].lat,
                    g->vertices[dst].lon);

                if (!heap_push(&heap, v, candidate + h))
                {
                    snprintf(result.message, sizeof(result.message),
                             "Priority queue allocation failed");
                    goto cleanup;
                }
            }
        }
    }

    if (!closed[dst])
    {
        snprintf(result.message, sizeof(result.message),
                 "No route found between these locations");
        goto cleanup;
    }

    int length = 0;

    for (int v = dst; v != -1; v = prev[v])
    {
        length++;

        if (length > n)
        {
            snprintf(result.message, sizeof(result.message),
                     "Invalid predecessor chain");
            goto cleanup;
        }
    }

    result.vertices = malloc((size_t)length * sizeof(int));

    if (!result.vertices)
    {
        snprintf(result.message, sizeof(result.message),
                 "Path allocation failed");
        goto cleanup;
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

cleanup:
    free(dist);
    free(prev);
    free(closed);
    free(heap.items);

    clock_gettime(CLOCK_MONOTONIC, &end);
    result.elapsed_ms = elapsed_ms(start, end);

    return result;
}