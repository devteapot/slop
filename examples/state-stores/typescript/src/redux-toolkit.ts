import { configureStore, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { createSlop, exposeStore } from "@slop-ai/client";
import { createTodo, createTodoIdFactory, projectTodos, type Todo, type TodoExample } from "./shared";

interface TodosState {
  items: Todo[];
}

const todosSlice = createSlice({
  name: "todos",
  initialState: { items: [] } as TodosState,
  reducers: {
    todoAdded(state, action: PayloadAction<Todo>) {
      state.items.push(action.payload);
    },
    todoToggled(state, action: PayloadAction<string>) {
      const todo = state.items.find((item) => item.id === action.payload);
      if (todo) {
        todo.done = !todo.done;
      }
    },
    doneCleared(state) {
      state.items = state.items.filter((todo) => !todo.done);
    },
  },
});

export const { doneCleared, todoAdded, todoToggled } = todosSlice.actions;

export function createReduxToolkitExample(): TodoExample & {
  store: ReturnType<typeof configureStore<{ todos: TodosState }>>;
} {
  const nextId = createTodoIdFactory();

  const store = configureStore({
    reducer: {
      todos: todosSlice.reducer,
    },
  });

  const addTodo = (title: string) => {
    const todo = createTodo(title, nextId);
    store.dispatch(todoAdded(todo));
    return todo;
  };
  const toggleTodo = (id: string) => store.dispatch(todoToggled(id));
  const clearDone = () => store.dispatch(doneCleared());

  const slop = createSlop({
    id: "redux-toolkit-todos",
    name: "Redux Toolkit Todos",
    transports: [],
  });

  const dispose = exposeStore(
    slop,
    "todos",
    store,
    (state) =>
      projectTodos({
        todos: state.todos.items,
        addTodo,
        toggleTodo,
        clearDone,
      }),
    {
      equals: (previous, next) => previous.todos.items === next.todos.items,
    },
  );

  return {
    store,
    slop,
    dispose,
    getTodos: () => store.getState().todos.items,
    addTodo,
    toggleTodo,
    clearDone,
  };
}
