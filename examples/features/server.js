const { readFileSync } = require("fs");
const express = require("express");
const bodyParser = require("body-parser");
const { graphqlExpress, graphiqlExpress } = require("graphql-server-express");
const {
  makeExecutableSchema,
  addMockFunctionsToSchema
} = require("graphql-tools");
const { examples } = require("./examples");

const typeDefs = readFileSync("src/schema.gql", "utf8");
const schema = makeExecutableSchema({ typeDefs });
addMockFunctionsToSchema({ schema });

const app = express();
app.use("/graphql", bodyParser.json(), graphqlExpress({ schema }));
app.use("/graphiql", graphiqlExpress({ endpointURL: "/graphql" }));
app.use(express.static(`${__dirname}/src`));
app.listen(3000);

console.log("server started on http://localhost:3000");
console.log("graphql endpoint: http://localhost:3000/graphql");
console.log("graphiql        : http://localhost:3000/graphiql");
console.log("examples        :");
examples.forEach(example =>
  console.log(`                  http://localhost:3000/${example}`)
);