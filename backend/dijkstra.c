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
    double distance;
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

static int heap_push(MinHeap *heap, int vertex, double distance)
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

        if (heap->items[parent].distance <= distance)
            break;

        heap->items[i] = heap->items[parent];
        i = parent;
    }

    heap->items[i].vertex = vertex;
    heap->items[i].distance = distance;

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
            heap->items[left].distance < last.distance)
        {
            smallest = left;
        }

        if (right < heap->size &&
            heap->items[right].distance <
                (smallest == i ? last.distance : heap->items[left].distance))
        {
            smallest = right;
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

PathResult dijkstra(const Graph *g, int src, int dst)
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
    unsigned char *visited = calloc((size_t)n, 1);

    if (!dist || !prev || !visited)
    {
        free(dist);
        free(prev);
        free(visited);

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

    dist[src] = 0;

    if (!heap_push(&heap, src, 0))
    {
        snprintf(result.message, sizeof(result.message),
                 "Priority queue allocation failed");
        goto cleanup;
    }

    while (heap.size > 0)
    {
        HeapNode current = heap_pop(&heap);
        int u = current.vertex;

        if (visited[u])
            continue;
        if (current.distance > dist[u])
            continue;

        visited[u] = 1;
        result.explored++;

        if (u == dst)
            break;

        for (int e = g->vertices[u].head; e != -1;
             e = g->edges[e].next)
        {

            int v = g->edges[e].to;
            double weight = g->edges[e].weight;
            double candidate = dist[u] + weight;

            if (!visited[v] && candidate < dist[v])
            {
                dist[v] = candidate;
                prev[v] = u;

                if (!heap_push(&heap, v, candidate))
                {
                    snprintf(result.message, sizeof(result.message),
                             "Priority queue allocation failed");
                    goto cleanup;
                }
            }
        }
    }

    if (!visited[dst])
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
    free(visited);
    free(heap.items);

    clock_gettime(CLOCK_MONOTONIC, &end);
    result.elapsed_ms = elapsed_ms(start, end);

    return result;
}