#define _POSIX_C_SOURCE 200809L
#include "graph.h"
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <math.h>
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
static double elapsed_ms(
    struct timespec start,
    struct timespec end)
{
    return (end.tv_sec - start.tv_sec) * 1000.0 +
           (end.tv_nsec - start.tv_nsec) / 1000000.0;
}
static int heap_push(
    MinHeap *heap,
    int vertex,
    double distance)
{
    if (heap->size >= heap->capacity)
    {
        int new_capacity =
            heap->capacity ? heap->capacity * 2 : 1024;
        HeapNode *new_items = realloc(
            heap->items,
            (size_t)new_capacity * sizeof(HeapNode));
        if (!new_items)
            return 0;
        heap->items = new_items;
        heap->capacity = new_capacity;
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
        if (left >= heap->size)
            break;
        int smallest = left;
        if (
            right < heap->size &&
            heap->items[right].distance <
                heap->items[left].distance)
        {
            smallest = right;
        }
        if (
            heap->items[smallest].distance >=
            last.distance)
        {
            break;
        }
        heap->items[i] = heap->items[smallest];
        i = smallest;
    }
    if (heap->size > 0)
        heap->items[i] = last;
    return result;
}
static int valid_vertex(
    const Graph *g,
    int vertex)
{
    return g &&
           g->vertices &&
           vertex >= 0 &&
           vertex < g->n;
}
static int reconstruct_path(
    const Graph *g,
    int src,
    int dst,
    const int *prev,
    PathResult *result)
{
    int length = 0;
    int current = dst;
    while (current != -1)
    {
        if (current < 0 || current >= g->n)
            return 0;
        length++;
        if (current == src)
            break;
        if (length > g->n)
            return 0;
        current = prev[current];
    }
    if (current != src || length <= 0)
        return 0;
    int *path = malloc((size_t)length * sizeof(int));
    if (!path)
        return 0;
    current = dst;
    for (int i = length - 1; i >= 0; i--)
    {
        path[i] = current;
        if (i > 0)
            current = prev[current];
    }
    result->vertices = path;
    result->length = length;
    return 1;
}
PathResult dijkstra(
    const Graph *g,
    int src,
    int dst)
{
    PathResult result = {0};
    struct timespec start, end;
    clock_gettime(CLOCK_MONOTONIC, &start);
    if (!valid_vertex(g, src) ||
        !valid_vertex(g, dst))
    {
        snprintf(
            result.message,
            sizeof(result.message),
            "Invalid source or destination");
        goto finish;
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
        snprintf(
            result.message,
            sizeof(result.message),
            "Memory allocation failed");
        goto finish;
    }
    for (int i = 0; i < n; i++)
    {
        dist[i] = INF;
        prev[i] = -1;
    }
    MinHeap heap = {0};
    dist[src] = 0.0;
    if (!heap_push(&heap, src, 0.0))
    {
        snprintf(
            result.message,
            sizeof(result.message),
            "Priority queue allocation failed");
        free(dist);
        free(prev);
        free(visited);
        free(heap.items);
        goto finish;
    }
    while (heap.size > 0)
    {
        HeapNode current = heap_pop(&heap);
        int u = current.vertex;
        // Ignore outdated entries and already-finalized vertices.
        if (visited[u])
            continue;
        if (current.distance > dist[u])
            continue;
        visited[u] = 1;
        result.explored++;
        // Nonnegative weights make this termination safe.
        if (u == dst)
            break;
        for (
            int e = g->vertices[u].head;
            e != -1;
            e = g->edges[e].next)
        {
            result.edge_examinations++;
            int v = g->edges[e].to;
            double weight = g->edges[e].weight;
            if (
                v < 0 ||
                v >= n ||
                !isfinite(weight) ||
                weight < 0.0)
            {
                snprintf(
                    result.message,
                    sizeof(result.message),
                    "Invalid or negative edge weight");
                free(dist);
                free(prev);
                free(visited);
                free(heap.items);
                goto finish;
            }
            if (visited[v])
                continue;
            double candidate = dist[u] + weight;
            if (candidate < dist[v])
            {
                dist[v] = candidate;
                prev[v] = u;
                result.successful_relaxations++;
                if (!heap_push(&heap, v, candidate))
                {
                    snprintf(
                        result.message,
                        sizeof(result.message),
                        "Priority queue allocation failed");
                    free(dist);
                    free(prev);
                    free(visited);
                    free(heap.items);
                    goto finish;
                }
            }
        }
    }
    if (!visited[dst])
    {
        snprintf(
            result.message,
            sizeof(result.message),
            "No route found between these locations");
        free(dist);
        free(prev);
        free(visited);
        free(heap.items);
        goto finish;
    }
    result.cost = dist[dst];
    if (!reconstruct_path(g, src, dst, prev, &result))
    {
        snprintf(
            result.message,
            sizeof(result.message),
            "Could not reconstruct the shortest path");
        free(dist);
        free(prev);
        free(visited);
        free(heap.items);
        goto finish;
    }
    result.found = 1;
    snprintf(
        result.message,
        sizeof(result.message),
        "Shortest route found");
    free(dist);
    free(prev);
    free(visited);
    free(heap.items);
finish:
    clock_gettime(CLOCK_MONOTONIC, &end);
    result.elapsed_ms = elapsed_ms(start, end);
    return result;
}