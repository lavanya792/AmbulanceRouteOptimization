#ifndef GRAPH_H
#define GRAPH_H
#define INF 1e100
/*
 * Directed adjacency-list edge.
 * Each edge represents travel from the current vertex to `to`.
 * Weight is road distance in metres.
 */
typedef struct
{
    int to;
    double weight;
    int next;
} AdjEdge;
/* Road intersection. */
typedef struct
{
    long long osm_id;
    double lat;
    double lon;
    int head;
} Vertex;
/* Dynamic road graph. */
typedef struct
{
    int n;
    int m;
    Vertex *vertices;
    AdjEdge *edges;
    int edge_count;
    int edge_capacity;
} Graph;
/*
 * Result returned by shortest-path algorithms.
 *
 * explored:
 *   Dijkstra/A*: number of vertices finalized/closed.
 *   Bellman-Ford: number of distinct reachable vertices whose
 *   outgoing adjacency lists were examined.
 *
 * edge_examinations:
 *   Number of edges inspected by the algorithm.
 *
 * successful_relaxations:
 *   Number of times a shorter distance was found.
 *
 * relaxation_passes:
 *   Number of passes performed by Bellman-Ford.
 */
typedef struct
{
    int *vertices;
    int length;
    double cost;
    int explored;
    int edge_examinations;
    int successful_relaxations;
    int relaxation_passes;
    int found;
    double elapsed_ms;
    char message[160];
} PathResult;
/* Edge returned by MST algorithms. */
typedef struct
{
    int from;
    int to;
    double weight;
} Edge;
/* Graph management. */
int graph_init(Graph *g, int vertex_count, int edge_capacity);
void graph_free(Graph *g);
int graph_add_edge(Graph *g, int u, int v, double w);
int graph_load_csv(
    Graph *g,
    const char *nodes_file,
    const char *edges_file);
int graph_nearest_vertex(
    const Graph *g,
    double lat,
    double lon);
/* Shortest-path algorithms. */
PathResult dijkstra(const Graph *g, int src, int dst);
PathResult astar(const Graph *g, int src, int dst);
PathResult bellman_ford(const Graph *g, int src, int dst);
/* Minimum spanning tree algorithms. */
int prim_mst(
    const Graph *g,
    Edge **out,
    int *count,
    double *total);
int kruskal_mst(
    const Graph *g,
    Edge **out,
    int *count,
    double *total);
/* Memory management for path results. */
void path_result_free(PathResult *result);
#endif